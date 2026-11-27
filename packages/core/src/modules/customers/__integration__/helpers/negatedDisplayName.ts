import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { looksLikeEncryptedPayload } from '@open-mercato/shared/lib/encryption/aes'
import { serializeTree } from '@open-mercato/shared/lib/query/advanced-filter'

const customerEntity = 'customers:customer_entity'

export async function expectNegatedDisplayNameFilter(
  request: APIRequestContext,
  resource: 'people' | 'companies',
  { encrypted }: { encrypted: boolean },
): Promise<void> {
  const token = await getAuthToken(request, 'superadmin')
  const tenantId = randomUUID()
  const fixtureName = `QA ${resource} name filter ${tenantId}`
  const path = `/api/customers/${resource}`
  const ids: string[] = []
  let organizationId: string | undefined
  const scopedRequest = (method: string, url: string, data?: unknown) => apiRequest(request, method, url, {
    token,
    data,
    headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
  })

  try {
    await withClient(async (client) => {
      await client.query(
        'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
        [tenantId, fixtureName],
      )
    })
    organizationId = await createOrganizationInDb({ name: fixtureName, tenantId })
    const map = await scopedRequest('POST', '/api/entities/encryption', {
      entityId: customerEntity,
      fields: [{ field: encrypted ? 'display_name' : 'primary_email' }],
    })
    await expect(map).toBeOK()

    const listIds = async (query = '') => {
      const response = await scopedRequest('GET', `${path}${query}`)
      await expect(response).toBeOK()
      const body = await readJsonSafe<{ items: { id: string }[] }>(response)
      expect(body?.items).toBeInstanceOf(Array)
      return body?.items.map(({ id }) => id) ?? []
    }
    const createCustomer = async (firstName: string) => {
      const displayName = `${firstName} Filter Fixture`
      const data = resource === 'people' ? { firstName, lastName: 'Filter Fixture', displayName } : { displayName }
      const response = await scopedRequest('POST', path, data)
      await expect(response).toBeOK()
      const body = await readJsonSafe<{ id: string }>(response)
      const id = expectId(body?.id, `POST ${path} should return a fixture id`)
      ids.push(id)

      const storedName = await withClient(async (client) => {
        const result = await client.query<{ display_name: string }>(
          'select display_name from customer_entities where id = $1 and tenant_id = $2 and organization_id = $3',
          [id, tenantId, organizationId],
        )
        return result.rows[0]?.display_name
      })
      expect(storedName).toBeDefined()
      expect(looksLikeEncryptedPayload(storedName)).toBe(encrypted)
      if (!encrypted) expect(storedName).toBe(displayName)
      return id
    }

    const matchingId = await createCustomer('Copperleaf')
    const nonmatchingId = await createCustomer('Brightside')
    expect((await listIds()).sort()).toEqual([matchingId, nonmatchingId].sort())

    const matchTerm = encrypted ? 'copperleaf' : 'leaf'
    const query = new URLSearchParams(serializeTree({
      root: {
        id: 'root',
        type: 'group',
        combinator: 'and',
        children: [{ id: 'name', type: 'rule', field: 'display_name', operator: 'does_not_contain', value: matchTerm }],
      },
    }))
    expect(await listIds(`?${query}`)).toEqual([nonmatchingId])
  } finally {
    try {
      const deleted = await Promise.allSettled(ids.map((id) => scopedRequest('DELETE', `${path}?id=${id}`)))
      for (const result of deleted) {
        if (result.status === 'rejected') throw result.reason
        await expect(result.value).toBeOK()
      }
    } finally {
      await withClient(async (client) => {
        await client.query('delete from encryption_maps where tenant_id = $1', [tenantId])
        await client.query('delete from organizations where id = $1 and tenant_id = $2', [organizationId, tenantId])
        await client.query('delete from tenants where id = $1', [tenantId])
      })
    }
  }
}
