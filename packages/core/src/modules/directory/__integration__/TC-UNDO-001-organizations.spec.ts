import { randomUUID } from 'node:crypto'
import { expect, test as base, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, extractOperation, redoOk, skipIfUndoTestsDisabled, undoByToken, undoOk, type Operation } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['directory', 'audit_logs', 'entities'] }

const ORGANIZATIONS = '/api/directory/organizations'
const TENANTS = '/api/directory/tenants'
const ALL_ORGANIZATIONS = { Cookie: 'om_selected_org=__all__' }

type Organization = Record<string, unknown> & {
  id: string
  parentId: string | null
  updatedAt: string
  childIds: string[]
}

type Lifecycle = { createdAt: string; updatedAt: string; deletedAt: string | null }

type DirectoryFixture = {
  token: string
  tenantId: string
  rootId: string
  selectedRequest: APIRequestContext
  create: (data?: Record<string, unknown>) => Promise<{ id: string; operation: Operation }>
  customFieldKey: () => string
  read: (ids: string[]) => Promise<Record<string, Organization>>
}

const test = base.extend<{ directory: DirectoryFixture }>({
  directory: async ({ request, playwright, baseURL }, use) => {
    const token = await getAuthToken(request, 'superadmin')
    const tenantId = expectId(getTokenContext(token).tenantId, 'superadmin has a tenant')
    const stamp = randomUUID().replaceAll('-', '')
    const organizationIds: string[] = []
    let selectedRequest: APIRequestContext | undefined

    const create: DirectoryFixture['create'] = async (data = {}) => {
      const response = await apiRequest(request, 'POST', ORGANIZATIONS, {
        token,
        headers: ALL_ORGANIZATIONS,
        data: { tenantId, name: `Undo ${stamp} ${organizationIds.length}`, ...data },
      })
      expect(response.status(), 'organization fixture created').toBe(201)
      const body = await readJsonSafe<{ id?: string }>(response)
      const id = expectId(body?.id, 'organization response has an id')
      organizationIds.push(id)
      return { id, operation: expectOperation(response, 'directory.organizations.create') }
    }

    const read: DirectoryFixture['read'] = async (ids) => {
      const query = new URLSearchParams({ view: 'manage', tenantId, ids: ids.join(','), pageSize: '100' })
      const response = await apiRequest(request, 'GET', `${ORGANIZATIONS}?${query}`, {
        token, headers: ALL_ORGANIZATIONS,
      })
      expect(response.status(), 'organization manage view readable').toBe(200)
      const body = await readJsonSafe<{ items: Organization[] }>(response)
      expect(Array.isArray(body?.items), 'manage view returns items').toBe(true)
      return Object.fromEntries((body?.items ?? []).map((record) => [record.id, record]))
    }

    try {
      const { id: rootId } = await create()
      selectedRequest = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { Cookie: `om_selected_org=${rootId}` },
      })
      await use({
        token,
        tenantId,
        rootId,
        selectedRequest,
        create,
        customFieldKey: () => `undo_${randomUUID().replaceAll('-', '')}`,
        read,
      })
    } finally {
      try {
        const remaining = organizationIds.length ? await read(organizationIds).catch(() => ({} as Record<string, Organization>)) : {}
        const cleanupIds = [...organizationIds].sort((left, right) => Number(remaining[right]?.depth ?? 0) - Number(remaining[left]?.depth ?? 0))
        for (const id of cleanupIds) {
          await deleteGeneralEntityIfExists(request, token, ORGANIZATIONS, id)
        }
      } finally {
        await selectedRequest?.dispose()
      }
    }
  },
})

function requiredOrganization(records: Record<string, Organization>, id: string): Organization {
  expect(records[id], `organization ${id} is visible`).toBeDefined()
  return records[id]
}

function stateWithoutVersions(records: Record<string, Organization>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => {
    const { updatedAt, ...state } = record
    expect(Number.isFinite(Date.parse(updatedAt)), 'updatedAt is a timestamp').toBe(true)
    return [id, state]
  }))
}

async function lifecycle(tenantId: string, id: string): Promise<Lifecycle | null> {
  return withClient(async (client) => {
    const result = await client.query<Lifecycle>(
      'select created_at::text as "createdAt", updated_at::text as "updatedAt", deleted_at::text as "deletedAt" from organizations where tenant_id = $1 and id = $2',
      [tenantId, id],
    )
    return result.rows[0] ?? null
  })
}

async function persistedState(tenantId: string, ids: string[]): Promise<Record<string, unknown>[]> {
  return withClient(async (client) => {
    const result = await client.query(
      'select id, tenant_id, name, slug, logo_url, logo_preserve_aspect_ratio, is_active, parent_id, root_id, tree_path, depth, ancestor_ids, child_ids, descendant_ids from organizations where tenant_id = $1 and id = any($2::uuid[]) and deleted_at is null order by id',
      [tenantId, ids],
    )
    return result.rows
  })
}

async function expectTenantLevelLog(request: APIRequestContext, token: string, operation: Operation): Promise<void> {
  const query = new URLSearchParams({
    resourceKind: 'directory.organization', resourceId: expectId(operation.resourceId, 'operation has a resource'), pageSize: '100',
  })
  const response = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query}`, {
    token, headers: ALL_ORGANIZATIONS,
  })
  expect(response.status(), 'public action history readable').toBe(200)
  const body = await readJsonSafe<{ items: Array<{ id: string; organizationId: string | null }> }>(response)
  const log = body?.items.find((entry) => entry.id === operation.logId)
  expect(log, 'operation appears in public action history').toBeDefined()
  expect(log?.organizationId, 'tenant-level organization log has null scope (#2398/#2417)').toBeNull()
}

async function expectConsumed(request: APIRequestContext, token: string, operation: Operation): Promise<void> {
  const response = await undoByToken(request, token, operation.undoToken)
  expect(response.status(), 'consumed token rejects double undo (I5)').toBe(400)
  expect(await readJsonSafe(response)).toMatchObject({ error: 'Undo token not available' })
}

test.describe('TC-UNDO-001 directory organizations', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('create → undo → redo restores identity, fields, custom fields, and child links', async ({ request, directory }) => {
    const field = directory.customFieldKey()
    const child = await directory.create({ parentId: directory.rootId })
    const before = await directory.read([directory.rootId, child.id])
    const beforeStored = await persistedState(directory.tenantId, [directory.rootId, child.id])
    const fields = {
      name: `Create ${randomUUID()}`, slug: `create-${randomUUID()}`,
      logoUrl: 'https://example.com/undo-before.svg', logoPreserveAspectRatio: true,
      isActive: false, parentId: directory.rootId, childIds: [child.id],
    }
    const created = await directory.create({ ...fields, customFields: { [field]: 5 } })
    const ids = [directory.rootId, child.id, created.id]
    const after = await directory.read(ids)
    const afterStored = await persistedState(directory.tenantId, ids)
    expect(requiredOrganization(after, created.id)).toMatchObject({ ...fields, [`cf_${field}`]: 5 })
    expect(requiredOrganization(after, child.id).parentId).toBe(created.id)
    await expectTenantLevelLog(request, directory.token, created.operation)

    await undoOk(directory.selectedRequest, directory.token, created.operation.undoToken, 'undo tenant-level organization create')
    expect(stateWithoutVersions(await directory.read(ids))).toEqual(stateWithoutVersions(before))
    expect(await persistedState(directory.tenantId, ids)).toEqual(beforeStored)
    await expectConsumed(directory.selectedRequest, directory.token, created.operation)

    await redoOk(directory.selectedRequest, directory.token, created.operation.logId, 'redo organization create')
    expect(stateWithoutVersions(await directory.read(ids))).toEqual(stateWithoutVersions(after))
    expect(await persistedState(directory.tenantId, ids)).toEqual(afterStored)
  })

  test('update → undo → redo restores all scalars, hierarchy collections, and custom fields (I1/I4/I6)', async ({ request, directory }) => {
    const field = directory.customFieldKey()
    const removedField = directory.customFieldKey()
    const parent = await directory.create({ parentId: directory.rootId })
    const subject = await directory.create({
      name: `Before ${randomUUID()}`, slug: `before-${randomUUID()}`,
      parentId: directory.rootId, logoUrl: 'https://example.com/undo-before.svg',
      logoPreserveAspectRatio: true, isActive: true, customFields: { [field]: 5, [removedField]: 7 },
    })
    const child = await directory.create({ parentId: subject.id })
    const replacement = await directory.create({ parentId: directory.rootId })
    const ids = [directory.rootId, parent.id, subject.id, child.id, replacement.id]
    const before = await directory.read(ids)
    const beforeStored = await persistedState(directory.tenantId, ids)
    expect(requiredOrganization(before, subject.id)[`cf_${removedField}`]).toBe(7)
    const beforeLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(beforeLifecycle).not.toBeNull()
    const fields = {
      name: `After ${randomUUID()}`, slug: `after-${randomUUID()}`,
      logoUrl: 'https://example.com/undo-after.svg', logoPreserveAspectRatio: false,
      isActive: false, parentId: parent.id, childIds: [replacement.id],
    }
    const response = await apiRequest(request, 'PUT', ORGANIZATIONS, {
      token: directory.token, headers: ALL_ORGANIZATIONS,
      data: { id: subject.id, ...fields, customFields: { [field]: 10, [removedField]: null } },
    })
    expect(response.status(), 'organization updated').toBe(200)
    const operation = expectOperation(response, 'directory.organizations.update')
    const after = await directory.read(ids)
    const afterStored = await persistedState(directory.tenantId, ids)
    const updated = requiredOrganization(after, subject.id)
    expect(updated).toMatchObject({ ...fields, [`cf_${field}`]: 10 })
    expect(updated[`cf_${removedField}`], 'custom-field value cleared by update').toBeNull()
    expect(requiredOrganization(after, child.id).parentId).toBeNull()
    expect(requiredOrganization(after, replacement.id).parentId).toBe(subject.id)
    await expectTenantLevelLog(request, directory.token, operation)

    await undoOk(directory.selectedRequest, directory.token, operation.undoToken, 'undo organization update')
    const undone = await directory.read(ids)
    expect(stateWithoutVersions(undone)).toEqual(stateWithoutVersions(before))
    expect(await persistedState(directory.tenantId, ids)).toEqual(beforeStored)
    expect(Date.parse(requiredOrganization(undone, subject.id).updatedAt)).toBeGreaterThan(Date.parse(updated.updatedAt))
    expect((await lifecycle(directory.tenantId, subject.id))?.createdAt).toBe(beforeLifecycle?.createdAt)
    await expectConsumed(directory.selectedRequest, directory.token, operation)

    await redoOk(directory.selectedRequest, directory.token, operation.logId, 'redo organization update')
    expect(stateWithoutVersions(await directory.read(ids))).toEqual(stateWithoutVersions(after))
    expect(await persistedState(directory.tenantId, ids)).toEqual(afterStored)
  })

  test('delete → undo → redo restores tombstone, scalars, custom fields, and child parents (I2/I6)', async ({ request, directory }) => {
    const field = directory.customFieldKey()
    const subject = await directory.create({
      parentId: directory.rootId, logoUrl: 'https://example.com/undo-delete.svg',
      logoPreserveAspectRatio: true, isActive: true, customFields: { [field]: 7 },
    })
    const child = await directory.create({ parentId: subject.id })
    const ids = [directory.rootId, subject.id, child.id]
    const before = await directory.read(ids)
    const beforeStored = await persistedState(directory.tenantId, ids)
    const beforeLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(beforeLifecycle).not.toBeNull()
    const response = await apiRequest(request, 'DELETE', `${ORGANIZATIONS}?id=${subject.id}`, {
      token: directory.token, headers: ALL_ORGANIZATIONS,
    })
    expect(response.status(), 'organization deleted').toBe(200)
    const operation = expectOperation(response, 'directory.organizations.delete')
    const deleted = await directory.read(ids)
    const deletedStored = await persistedState(directory.tenantId, ids)
    expect(deleted[subject.id]).toBeUndefined()
    expect(requiredOrganization(deleted, child.id).parentId).toBe(directory.rootId)
    const deletedLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(deletedLifecycle).not.toBeNull()
    expect(deletedLifecycle?.deletedAt).not.toBeNull()
    await expectTenantLevelLog(request, directory.token, operation)

    await undoOk(directory.selectedRequest, directory.token, operation.undoToken, 'undo organization delete')
    const undone = await directory.read(ids)
    expect(stateWithoutVersions(undone)).toEqual(stateWithoutVersions(before))
    expect(await persistedState(directory.tenantId, ids)).toEqual(beforeStored)
    const restoredLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(restoredLifecycle).not.toBeNull()
    expect(restoredLifecycle?.deletedAt).toBeNull()
    expect(restoredLifecycle?.createdAt).toBe(beforeLifecycle?.createdAt)
    expect(Date.parse(requiredOrganization(undone, subject.id).updatedAt)).toBeGreaterThan(Date.parse(requiredOrganization(before, subject.id).updatedAt))
    await expectConsumed(directory.selectedRequest, directory.token, operation)

    await redoOk(directory.selectedRequest, directory.token, operation.logId, 'redo organization delete')
    expect(stateWithoutVersions(await directory.read(ids))).toEqual(stateWithoutVersions(deleted))
    expect(await persistedState(directory.tenantId, ids)).toEqual(deletedStored)
    const redoneLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(redoneLifecycle).not.toBeNull()
    expect(redoneLifecycle?.deletedAt).not.toBeNull()
  })

  test('tenant create/update/delete expose no undo operation (§4)', async ({ request, directory }) => {
    let tenantId: string | null = null
    try {
      const created = await apiRequest(request, 'POST', TENANTS, {
        token: directory.token, data: { name: `No undo ${randomUUID()}` },
      })
      expect(created.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'tenant fixture has an id')
      expect(extractOperation(created), 'tenant create has no undo affordance').toBeNull()
      const updated = await apiRequest(request, 'PUT', TENANTS, {
        token: directory.token, data: { id: tenantId, name: `Updated ${randomUUID()}`, isActive: false },
      })
      expect(updated.status()).toBe(200)
      expect(extractOperation(updated), 'tenant update has no undo affordance').toBeNull()
      const deleted = await apiRequest(request, 'DELETE', `${TENANTS}?id=${tenantId}`, { token: directory.token })
      expect(deleted.status()).toBe(200)
      expect(extractOperation(deleted), 'tenant delete has no undo affordance').toBeNull()
    } finally {
      await deleteGeneralEntityIfExists(request, directory.token, TENANTS, tenantId)
    }
  })

  test('create → undo retains a soft-deleted row (I3)', async ({ directory }) => {
    const subject = await directory.create()
    await undoOk(directory.selectedRequest, directory.token, subject.operation.undoToken, 'undo create for tombstone assertion')
    const deleted = await lifecycle(directory.tenantId, subject.id)
    expect(deleted, 'create undo retains the row').not.toBeNull()
    expect(deleted?.deletedAt, 'create undo sets deleted_at').not.toBeNull()
  })

  test('create → undo → redo preserves created_at', async ({ directory }) => {
    const subject = await directory.create()
    const before = await lifecycle(directory.tenantId, subject.id)
    expect(before).not.toBeNull()
    await undoOk(directory.selectedRequest, directory.token, subject.operation.undoToken, 'undo create for timestamp assertion')
    await redoOk(directory.selectedRequest, directory.token, subject.operation.logId, 'redo create for timestamp assertion')
    expect((await lifecycle(directory.tenantId, subject.id))?.createdAt).toBe(before?.createdAt)
  })

  test('create → undo reserves the slug for redo while another same-name organization is created', async ({ directory }) => {
    const name = `Reserved ${randomUUID()}`
    const subject = await directory.create({ name })
    const before = requiredOrganization(await directory.read([subject.id]), subject.id)
    const originalLifecycle = await lifecycle(directory.tenantId, subject.id)

    await undoOk(directory.selectedRequest, directory.token, subject.operation.undoToken, 'undo create before same-name creation')
    const replacement = await directory.create({ name })
    const replacementState = requiredOrganization(await directory.read([replacement.id]), replacement.id)
    expect(replacement.id).not.toBe(subject.id)
    expect(replacementState.slug).toBe(`${String(before.slug)}-1`)

    await redoOk(directory.selectedRequest, directory.token, subject.operation.logId, 'redo create with reserved slug')
    const restored = await directory.read([subject.id, replacement.id])
    expect(requiredOrganization(restored, subject.id).slug).toBe(before.slug)
    expect(requiredOrganization(restored, replacement.id).slug).toBe(replacementState.slug)
    const restoredLifecycle = await lifecycle(directory.tenantId, subject.id)
    expect(restoredLifecycle?.deletedAt).toBeNull()
    expect(restoredLifecycle?.createdAt).toBe(originalLifecycle?.createdAt)
  })
})
