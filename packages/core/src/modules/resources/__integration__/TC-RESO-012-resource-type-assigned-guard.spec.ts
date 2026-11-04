import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Response } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { fillControlledInput, waitForApiMutation } from '@open-mercato/core/helpers/integration/ui'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  expectOperation,
  redoByLogId,
  skipIfUndoTestsDisabled,
  undoByToken,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-RESO-012: a live resource never points at a deleted resource type.
 *
 * Undoing a resource type create is refused with 409 while resources are assigned to the type (same rule as delete).
 * Resource create/update refuse a deleted resource type. Undo/redo that would bring a resource back onto a
 * type deleted meanwhile is refused with 409 until the type deletion itself is undone.
 * Resource types of another organization or another tenant are refused on create/update (400) and on
 * restores of rows that already reference them (409), and the resource is left unchanged.
 * Reads use a unique `probe` query param so the CRUD list cache never answers them.
 * Self-contained: resource types and resources are created via API and removed in teardown.
 */

const RESOURCES = '/api/resources/resources'
const RESOURCE_TYPES = '/api/resources/resource-types'
const ASSIGNED_ERROR = 'Resource type has assigned resources.'
const ASSIGNED_CODE = 'resources.resourceTypes.errors.deleteAssigned'
const UNAVAILABLE_ERROR = 'The selected resource type is no longer available.'
const UNAVAILABLE_CODE = 'resources.resources.errors.resourceTypeUnavailable'
const DELETED_CODE = 'resources.resources.errors.resourceTypeDeleted'

let probe = 0

async function createResourceType(request: APIRequestContext, token: string, name: string) {
  const res = await apiRequest(request, 'POST', RESOURCE_TYPES, { token, data: { name } })
  expect(res.status(), `resource type create (${name})`).toBe(201)
  const body = (await readJsonSafe(res)) as { id?: string } | null
  expect(typeof body?.id, 'resource type create returns an id').toBe('string')
  return { id: body!.id as string, operation: expectOperation(res, `resource type create (${name})`) }
}

async function createResource(request: APIRequestContext, token: string, name: string, resourceTypeId: string) {
  const res = await apiRequest(request, 'POST', RESOURCES, { token, data: { name, resourceTypeId } })
  expect(res.status(), `resource create (${name})`).toBe(201)
  return ((await readJsonSafe(res)) as { id: string }).id
}

async function readItem(request: APIRequestContext, token: string, path: string, id: string): Promise<Record<string, unknown> | null> {
  probe += 1
  const query = `ids=${encodeURIComponent(id)}&probe=${Date.now()}-${probe}`
  const res = await apiRequest(request, 'GET', `${path}?${query}`, { token })
  expect(res.ok(), `list ${path} status ${res.status()}`).toBeTruthy()
  const body = (await readJsonSafe(res)) as { items?: Array<Record<string, unknown>> } | null
  return (body?.items ?? []).find((item) => item.id === id) ?? null
}

async function deleteById(request: APIRequestContext, token: string, path: string, id: string) {
  const res = await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token })
  expect(res.ok(), `delete ${path} status ${res.status()}`).toBeTruthy()
  return res
}

function scopeCookie(scope: { tenantId?: string; organizationId: string }): Record<string, string> {
  const cookies = [`om_selected_org=${encodeURIComponent(scope.organizationId)}`]
  if (scope.tenantId) cookies.unshift(`om_selected_tenant=${encodeURIComponent(scope.tenantId)}`)
  return { Cookie: cookies.join('; ') }
}

async function createResourceTypeIn(
  request: APIRequestContext,
  token: string,
  scope: { tenantId?: string; organizationId: string },
  name: string,
) {
  const res = await apiRequest(request, 'POST', RESOURCE_TYPES, { token, data: { name }, headers: scopeCookie(scope) })
  expect(res.status(), `resource type create in ${scope.organizationId}`).toBe(201)
  return expectId(((await readJsonSafe(res)) as { id?: string } | null)?.id, 'resource type create returns an id')
}

async function deleteResourceTypeIn(
  request: APIRequestContext,
  token: string | null,
  scope: { tenantId?: string; organizationId: string } | null,
  id: string | null,
) {
  if (!token || !scope || !id) return
  await apiRequest(request, 'DELETE', `${RESOURCE_TYPES}?id=${encodeURIComponent(id)}`, { token, headers: scopeCookie(scope) })
    .catch(() => {})
}

async function pointResourceAtType(resourceId: string, resourceTypeId: string) {
  await withClient(async (client) => {
    const result = await client.query('update resources_resources set resource_type_id = $1 where id = $2', [resourceTypeId, resourceId])
    expect(result.rowCount, 'legacy reference fixture').toBe(1)
  })
}

async function createTenant(request: APIRequestContext, token: string, name: string) {
  const res = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  expect(res.status(), 'foreign tenant fixture').toBe(201)
  return expectId(((await readJsonSafe(res)) as { id?: string } | null)?.id, 'tenant create returns an id')
}

async function cleanup(request: APIRequestContext, token: string | null, resourceIds: string[], typeIds: string[]) {
  if (!token) return
  for (const id of resourceIds) {
    await apiRequest(request, 'DELETE', `${RESOURCES}?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
  }
  for (const id of typeIds) {
    await apiRequest(request, 'DELETE', `${RESOURCE_TYPES}?id=${encodeURIComponent(id)}`, { token }).catch(() => {})
  }
}

test.describe('TC-RESO-012: resource type "has assigned resources" rule on undo and resource writes', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('undoing a resource type create is refused while a resource is assigned to it', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const typeIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-undo`
      const type = await createResourceType(request, token, `QA RESO-012 type ${stamp}`)
      typeIds.push(type.id)
      resourceIds.push(await createResource(request, token, `QA RESO-012 resource ${stamp}`, type.id))

      const undoRes = await undoByToken(request, token, type.operation.undoToken)
      expect(undoRes.status(), 'type create undo with an assigned resource').toBe(409)
      expect(await readJsonSafe(undoRes)).toMatchObject({ error: ASSIGNED_ERROR, code: ASSIGNED_CODE })
      expect(await readItem(request, token, RESOURCE_TYPES, type.id), 'resource type stays live').not.toBeNull()

      const directDelete = await apiRequest(request, 'DELETE', `${RESOURCE_TYPES}?id=${encodeURIComponent(type.id)}`, { token })
      expect(directDelete.status(), 'direct delete keeps the same rule').toBe(400)
      expect(await readJsonSafe(directDelete)).toMatchObject({ error: ASSIGNED_ERROR, code: ASSIGNED_CODE })

      await deleteById(request, token, RESOURCES, resourceIds.pop() as string)
      await undoOk(request, token, type.operation.undoToken, 'type create undo once no resource is assigned')
      typeIds.pop()
      expect(await readItem(request, token, RESOURCE_TYPES, type.id), 'resource type removed by undo').toBeNull()
    } finally {
      await cleanup(request, token, resourceIds, typeIds)
    }
  })

  test('resource create and update refuse a deleted or unknown resource type', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const typeIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-write`
      const deletedType = await createResourceType(request, token, `QA RESO-012 deleted ${stamp}`)
      typeIds.push(deletedType.id)
      await deleteById(request, token, RESOURCE_TYPES, deletedType.id)
      typeIds.pop()

      const createRes = await apiRequest(request, 'POST', RESOURCES, {
        token,
        data: { name: `QA RESO-012 resource ${stamp}`, resourceTypeId: deletedType.id },
      })
      expect(createRes.status(), 'create with a deleted type').toBe(400)
      expect(await readJsonSafe(createRes)).toMatchObject({ error: UNAVAILABLE_ERROR, code: UNAVAILABLE_CODE })

      const unknownRes = await apiRequest(request, 'POST', RESOURCES, {
        token,
        data: { name: `QA RESO-012 unknown ${stamp}`, resourceTypeId: randomUUID() },
      })
      expect(unknownRes.status(), 'create with an unknown type').toBe(400)
      expect(await readJsonSafe(unknownRes)).toMatchObject({ code: UNAVAILABLE_CODE })

      const plainRes = await apiRequest(request, 'POST', RESOURCES, { token, data: { name: `QA RESO-012 plain ${stamp}` } })
      expect(plainRes.status(), 'create without a type').toBe(201)
      const resourceId = ((await readJsonSafe(plainRes)) as { id: string }).id
      resourceIds.push(resourceId)

      const updateRes = await apiRequest(request, 'PUT', RESOURCES, {
        token,
        data: { id: resourceId, resourceTypeId: deletedType.id },
        headers: { 'Accept-Language': 'de' },
      })
      expect(updateRes.status(), 'update to a deleted type').toBe(400)
      expect(await readJsonSafe(updateRes)).toMatchObject({
        error: 'Der ausgewählte Ressourcentyp ist nicht mehr verfügbar.',
        code: UNAVAILABLE_CODE,
      })
      const stored = await readItem(request, token, RESOURCES, resourceId)
      expect(stored?.resource_type_id ?? null, 'rejected update stored nothing').toBeNull()
    } finally {
      await cleanup(request, token, resourceIds, typeIds)
    }
  })

  test('resource delete undo, update undo and create redo are refused while the resource type is deleted', async ({ request }) => {
    let token: string | null = null
    const resourceIds: string[] = []
    const typeIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const stamp = `${Date.now()}-restore`
      const type = await createResourceType(request, token, `QA RESO-012 type ${stamp}`)
      typeIds.push(type.id)
      const deletedResource = await createResource(request, token, `QA RESO-012 deleted ${stamp}`, type.id)
      resourceIds.push(deletedResource)
      const resourceDeleteOp = expectOperation(
        await deleteById(request, token, RESOURCES, deletedResource),
        'resource delete',
      )
      const undoneCreateRes = await apiRequest(request, 'POST', RESOURCES, {
        token,
        data: { name: `QA RESO-012 undone ${stamp}`, resourceTypeId: type.id },
      })
      expect(undoneCreateRes.status(), 'second resource create').toBe(201)
      const undoneResource = ((await readJsonSafe(undoneCreateRes)) as { id: string }).id
      resourceIds.push(undoneResource)
      const resourceCreateOp = expectOperation(undoneCreateRes, 'second resource create')
      await undoOk(request, token, resourceCreateOp.undoToken, 'second resource create')
      const otherType = await createResourceType(request, token, `QA RESO-012 other ${stamp}`)
      typeIds.push(otherType.id)
      const movedResource = await createResource(request, token, `QA RESO-012 moved ${stamp}`, type.id)
      resourceIds.push(movedResource)
      const moveRes = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: movedResource, resourceTypeId: otherType.id } })
      expect(moveRes.status(), 'move resource to the other type').toBe(200)
      const resourceUpdateOp = expectOperation(moveRes, 'move resource to the other type')

      const typeDeleteOp = expectOperation(await deleteById(request, token, RESOURCE_TYPES, type.id), 'resource type delete')

      const undoRes = await undoByToken(request, token, resourceDeleteOp.undoToken)
      expect(undoRes.status(), 'resource delete undo onto a deleted type').toBe(409)
      expect(((await readJsonSafe(undoRes)) as { code?: string } | null)?.code).toBe(DELETED_CODE)
      expect(await readItem(request, token, RESOURCES, deletedResource), 'resource stays deleted').toBeNull()

      const redoRes = await redoByLogId(request, token, resourceCreateOp.logId)
      expect(redoRes.status(), 'resource create redo onto a deleted type').toBe(409)
      expect(((await readJsonSafe(redoRes)) as { code?: string } | null)?.code).toBe(DELETED_CODE)
      expect(await readItem(request, token, RESOURCES, undoneResource), 'resource stays undone').toBeNull()

      const updateUndoRes = await undoByToken(request, token, resourceUpdateOp.undoToken)
      expect(updateUndoRes.status(), 'resource update undo back onto a deleted type').toBe(409)
      expect(((await readJsonSafe(updateUndoRes)) as { code?: string } | null)?.code).toBe(DELETED_CODE)
      const moved = await readItem(request, token, RESOURCES, movedResource)
      expect(moved?.resource_type_id, 'moved resource keeps the live type').toBe(otherType.id)

      await undoOk(request, token, typeDeleteOp.undoToken, 'resource type delete')
      await undoOk(request, token, resourceDeleteOp.undoToken, 'resource delete once the type is back')
      const restored = await readItem(request, token, RESOURCES, deletedResource)
      expect(restored?.resource_type_id, 'restored resource keeps its type').toBe(type.id)
    } finally {
      await cleanup(request, token, resourceIds, typeIds)
    }
  })

  test('resource writes and restores refuse resource types of another organization or tenant', async ({ request }) => {
    test.slow()
    let token: string | null = null
    let superadminToken: string | null = null
    let otherOrgScope: { organizationId: string } | null = null
    let foreignScope: { tenantId: string; organizationId: string } | null = null
    let foreignTenantId: string | null = null
    let otherOrgTypeId: string | null = null
    let foreignTypeId: string | null = null
    const resourceIds: string[] = []
    const typeIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      superadminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenContext(token)
      const stamp = `${Date.now()}-scope`
      otherOrgScope = {
        organizationId: await createOrganizationFixture(request, superadminToken, { name: `QA RESO-012 org ${stamp}`, tenantId }),
      }
      foreignTenantId = await createTenant(request, superadminToken, `QA RESO-012 tenant ${stamp}`)
      foreignScope = {
        tenantId: foreignTenantId,
        organizationId: await createOrganizationFixture(request, superadminToken, {
          name: `QA RESO-012 foreign org ${stamp}`,
          tenantId: foreignTenantId,
        }),
      }
      otherOrgTypeId = await createResourceTypeIn(request, token, otherOrgScope, `QA RESO-012 other org type ${stamp}`)
      foreignTypeId = await createResourceTypeIn(request, superadminToken, foreignScope, `QA RESO-012 foreign type ${stamp}`)
      const homeType = await createResourceType(request, token, `QA RESO-012 home type ${stamp}`)
      typeIds.push(homeType.id)

      const foreignTypes = [
        { label: 'another organization', id: otherOrgTypeId },
        { label: 'another tenant', id: foreignTypeId },
      ]
      const resourceId = await createResource(request, token, `QA RESO-012 scoped ${stamp}`, homeType.id)
      resourceIds.push(resourceId)
      for (const foreign of foreignTypes) {
        const createRes = await apiRequest(request, 'POST', RESOURCES, {
          token,
          data: { name: `QA RESO-012 ${foreign.label} ${stamp}`, resourceTypeId: foreign.id },
        })
        expect(createRes.status(), `create with a type of ${foreign.label}`).toBe(400)
        expect(await readJsonSafe(createRes)).toMatchObject({ error: UNAVAILABLE_ERROR, code: UNAVAILABLE_CODE })

        const updateRes = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: resourceId, resourceTypeId: foreign.id } })
        expect(updateRes.status(), `update to a type of ${foreign.label}`).toBe(400)
        expect(await readJsonSafe(updateRes)).toMatchObject({ code: UNAVAILABLE_CODE })
        const stored = await readItem(request, token, RESOURCES, resourceId)
        expect(stored?.resource_type_id, `update to ${foreign.label} stored nothing`).toBe(homeType.id)

        const deletedResource = await createResource(request, token, `QA RESO-012 deleted ${foreign.label} ${stamp}`, homeType.id)
        resourceIds.push(deletedResource)
        await pointResourceAtType(deletedResource, foreign.id)
        const deleteOp = expectOperation(await deleteById(request, token, RESOURCES, deletedResource), `resource delete (${foreign.label})`)
        const deleteUndoRes = await undoByToken(request, token, deleteOp.undoToken)
        expect(deleteUndoRes.status(), `resource delete undo onto a type of ${foreign.label}`).toBe(409)
        expect(((await readJsonSafe(deleteUndoRes)) as { code?: string } | null)?.code).toBe(UNAVAILABLE_CODE)
        expect(await readItem(request, token, RESOURCES, deletedResource), `resource stays deleted (${foreign.label})`).toBeNull()

        const movedResource = await createResource(request, token, `QA RESO-012 moved ${foreign.label} ${stamp}`, homeType.id)
        resourceIds.push(movedResource)
        await pointResourceAtType(movedResource, foreign.id)
        const moveRes = await apiRequest(request, 'PUT', RESOURCES, { token, data: { id: movedResource, resourceTypeId: homeType.id } })
        expect(moveRes.status(), `move off a type of ${foreign.label}`).toBe(200)
        const moveOp = expectOperation(moveRes, `move off a type of ${foreign.label}`)
        const updateUndoRes = await undoByToken(request, token, moveOp.undoToken)
        expect(updateUndoRes.status(), `resource update undo back onto a type of ${foreign.label}`).toBe(409)
        expect(((await readJsonSafe(updateUndoRes)) as { code?: string } | null)?.code).toBe(UNAVAILABLE_CODE)
        const moved = await readItem(request, token, RESOURCES, movedResource)
        expect(moved?.resource_type_id, `moved resource keeps the home type (${foreign.label})`).toBe(homeType.id)
      }
    } finally {
      await cleanup(request, token, resourceIds, typeIds)
      await deleteResourceTypeIn(request, token, otherOrgScope, otherOrgTypeId)
      await deleteResourceTypeIn(request, superadminToken, foreignScope, foreignTypeId)
      await deleteOrganizationIfExists(request, superadminToken, otherOrgScope?.organizationId ?? null)
      await deleteOrganizationIfExists(request, superadminToken, foreignScope?.organizationId ?? null)
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId)
    }
  })

  test('the undo banner shows why a resource type create cannot be undone', async ({ page, request }) => {
    test.slow()
    let token: string | null = null
    const resourceIds: string[] = []
    const typeIds: string[] = []
    try {
      token = await getAuthToken(request, 'admin')
      const typeName = `QA RESO-012 ui type ${Date.now()}`
      await login(page, 'admin')
      await page.goto('/backend/resources/resource-types/create', { waitUntil: 'domcontentloaded' })
      const nameInput = page.locator('[data-crud-field-id="name"]').getByRole('textbox')
      const created: { response: Response | null } = { response: null }
      await expect(async () => {
        await fillControlledInput(nameInput, typeName)
        created.response = await waitForApiMutation(page, RESOURCE_TYPES, async () => {
          await page.getByRole('button', { name: 'Save' }).first().click()
        })
      }).toPass({ timeout: 45_000 })
      const createResponse = created.response
      if (!createResponse) throw new Error('[internal] resource type create response missing')
      expect(createResponse.status(), 'resource type create from the form').toBe(201)
      const typeId = ((await createResponse.json()) as { id: string }).id
      typeIds.push(typeId)
      await expect(page).toHaveURL(/\/backend\/resources\/resource-types$/)

      resourceIds.push(await createResource(request, token, `QA RESO-012 ui resource ${Date.now()}`, typeId))

      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ })
      await expect(undoButton).toBeVisible()
      const undoResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST',
      )
      await undoButton.click()
      expect((await undoResponsePromise).status(), 'banner undo is refused').toBe(409)
      await expect(page.getByText(ASSIGNED_ERROR).first()).toBeVisible()
      expect(await readItem(request, token, RESOURCE_TYPES, typeId), 'resource type stays live').not.toBeNull()
    } finally {
      await cleanup(request, token, resourceIds, typeIds)
    }
  })
})
