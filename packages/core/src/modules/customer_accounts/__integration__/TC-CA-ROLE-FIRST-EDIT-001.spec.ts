import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = {
  dependsOnModules: ['customer_accounts'],
}

const VERSION_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
const roleVersionSchema = z.object({ updatedAt: z.string().datetime() })
const roleSchema = roleVersionSchema.extend({
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  features: z.array(z.string()),
  isDefault: z.boolean(),
  customerAssignable: z.boolean(),
}).passthrough()
const createdRoleSchema = z.object({ role: z.object({ id: z.string().uuid() }) })
const roleListSchema = z.object({ items: z.array(roleVersionSchema.extend({ id: z.string().uuid() })) })

for (const legacy of [false, true]) {
  test(`TC-CA-ROLE-FIRST-EDIT-001: ${legacy ? 'legacy' : 'new'} role versions protect the first edit and delete`, async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const name = `QA first edit ${randomUUID()}`
    let roleId: string | null = null

    try {
      const created = await apiRequest(request, 'POST', '/api/customer_accounts/admin/roles', {
        token,
        data: { name, slug: `first-edit-${randomUUID()}`, description: 'Original description' },
      })
      expect(created.status()).toBe(201)
      const createdBody = createdRoleSchema.parse(await readJsonSafe(created))
      roleId = createdBody.role.id
      const path = `/api/customer_accounts/admin/roles/${roleId}`

      if (legacy) {
        await withClient(async (client) => {
          const result = await client.query(
            'update customer_roles set updated_at = null where id = $1 and tenant_id = $2 and organization_id = $3',
            [roleId, scope.tenantId, scope.organizationId],
          )
          expect(result.rowCount).toBe(1)
        })
      }

      const opened = await apiRequest(request, 'GET', path, { token })
      expect(opened.status()).toBe(200)
      const before = roleSchema.parse(await readJsonSafe(opened))
      expect(typeof before.updatedAt).toBe('string')
      if (legacy) expect(before.updatedAt).toBe(before.createdAt)
      const staleHeaders = { [VERSION_HEADER]: before.updatedAt }
      const listed = await apiRequest(request, 'GET', `/api/customer_accounts/admin/roles?search=${encodeURIComponent(name)}`, { token })
      expect(listed.status()).toBe(200)
      const listBody = roleListSchema.parse(await readJsonSafe(listed))
      expect(listBody.items.find((item) => item.id === roleId)?.updatedAt).toBe(before.updatedAt)

      const newer = await apiRequest(request, 'PUT', path, {
        token,
        headers: staleHeaders,
        data: { name: `${name} newer` },
      })
      expect(newer.status()).toBe(200)

      const staleUpdate = await apiRequest(request, 'PUT', path, {
        token,
        headers: staleHeaders,
        data: { name, description: 'Stale description' },
      })
      expect(staleUpdate.status()).toBe(409)
      expect(z.object({ code: z.string() }).parse(await readJsonSafe(staleUpdate)).code).toBe('optimistic_lock_conflict')
      const staleAcl = await apiRequest(request, 'PUT', `${path}/acl`, {
        token,
        headers: staleHeaders,
        data: { features: ['portal.orders.view'] },
      })
      expect(staleAcl.status()).toBe(409)
      const staleDelete = await apiRequest(request, 'DELETE', path, { token, headers: staleHeaders })
      expect(staleDelete.status()).toBe(409)

      const current = await apiRequest(request, 'GET', path, { token })
      const after = roleSchema.parse(await readJsonSafe(current))
      expect({ ...after, name: before.name, updatedAt: before.updatedAt }).toEqual(before)
    } finally {
      if (roleId) {
        const path = `/api/customer_accounts/admin/roles/${roleId}`
        const current = await apiRequest(request, 'GET', path, { token })
        if (current.ok()) {
          const body = roleVersionSchema.parse(await readJsonSafe(current))
          const removed = await apiRequest(request, 'DELETE', path, {
            token,
            headers: { [VERSION_HEADER]: body.updatedAt },
          })
          expect(removed.status()).toBe(200)
        }
      }
    }
  })
}
