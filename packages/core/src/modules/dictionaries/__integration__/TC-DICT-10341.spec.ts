import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-DICT-10341: Sales can still resolve its protected order-status dictionary', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(adminToken)
  const token = await getAuthToken(request, 'superadmin')
  const organizationId = await createOrganizationInDb({ tenantId, name: `Dictionary preservation ${randomUUID()}` })
  const scope = {
    token,
    headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
  }
  const key = 'sales.order_status'

  try {
    const created = await apiRequest(request, 'POST', '/api/dictionaries', {
      ...scope,
      data: { key, name: 'Test order statuses', isSystem: true },
    })
    expect(created.status()).toBe(201)
    const dictionaryId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'Dictionary fixture ID')
    const path = `/api/dictionaries/${dictionaryId}`
    const detail = await apiRequest(request, 'GET', path, scope)
    expect(detail.status()).toBe(200)
    expect(await detail.json()).toMatchObject({ organizationId, key, isSystem: true, isActive: true })

    const entry = await apiRequest(request, 'POST', `${path}/entries`, {
      ...scope,
      data: { value: 'qa_status', label: 'QA status' },
    })
    expect(entry.status()).toBe(201)
    const entryId = expectId((await readJsonSafe<{ id: string }>(entry))?.id, 'Order status fixture ID')

    const edited = await apiRequest(request, 'PATCH', path, {
      ...scope,
      data: { key, name: 'Updated order statuses', entrySortMode: 'value_asc' },
    })
    expect(edited.status()).toBe(200)
    expect(await edited.json()).toMatchObject({ key, name: 'Updated order statuses', entrySortMode: 'value_asc' })

    for (const data of [{ key: 'sales.renamed_order_status' }, { isActive: false }]) {
      const response = await apiRequest(request, 'PATCH', path, { ...scope, data })
      expect(response.status()).toBe(400)
    }
    const deleted = await apiRequest(request, 'DELETE', path, scope)
    expect(deleted.status()).toBe(400)

    const preserved = await apiRequest(request, 'GET', path, scope)
    expect(preserved.status()).toBe(200)
    expect(await preserved.json()).toMatchObject({ id: dictionaryId, key, isSystem: true, isActive: true })
    const statuses = await apiRequest(request, 'GET', `/api/sales/order-statuses?id=${entryId}`, scope)
    expect(statuses.status()).toBe(200)
    expect((await readJsonSafe<{ items: Array<{ id: string }> }>(statuses))?.items)
      .toContainEqual(expect.objectContaining({ id: entryId }))
  } finally {
    await withClient(async (client) => {
      await client.query('delete from dictionary_entries where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      await client.query('delete from dictionaries where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
      await client.query('delete from organizations where tenant_id = $1 and id = $2', [tenantId, organizationId])
    })
  }
})
