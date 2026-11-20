import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['documents', 'customers'] }

type Mutation = { id?: string; entityId?: string }
type List = { items?: Array<{ id: string; label?: string; restricted?: boolean }> }

test('TC-DOCUMENTS-030 verifies exact ownership while ordinary Customers reads include descendants', async ({ request }) => {
  const token = await getAuthToken(request)
  const { tenantId } = getTokenScope(token)
  const tag = randomUUID()
  const organizations: string[] = []
  const people: string[] = []
  let documentId: string | null = null
  try {
    const parentId = await createOrganizationInDb({ tenantId, name: `Documents exact parent ${tag}` })
    organizations.push(parentId)
    const childId = await createOrganizationInDb({ tenantId, name: `Documents exact child ${tag}` })
    organizations.push(childId)
    await withClient(async (client) => {
      await client.query('update organizations set parent_id = $1, ancestor_ids = $2::jsonb, depth = 1 where id = $3', [parentId, JSON.stringify([parentId]), childId])
      await client.query('update organizations set child_ids = $1::jsonb, descendant_ids = $1::jsonb where id = $2', [JSON.stringify([childId]), parentId])
    })
    for (const organizationId of [parentId, childId]) {
      const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/people', {
        token, selectedOrgId: organizationId,
        data: { firstName: 'Documents', lastName: organizationId === parentId ? 'Exact owner' : 'Descendant only' },
      })
      expect(response.status()).toBe(201)
      const body = await readJsonSafe<Mutation>(response)
      people.push(expectId(body?.entityId ?? body?.id, 'Person entity ID'))
    }
    const [parentPersonId, childPersonId] = people
    const ordinary = await apiRequestWithSelectedOrg(request, 'GET', `/api/customers/people?id=${childPersonId}`, { token, selectedOrgId: parentId })
    expect(ordinary.status()).toBe(200)
    expect((await readJsonSafe<List>(ordinary))?.items?.map((item) => item.id)).toContain(childPersonId)

    for (const exact of [
      `exactOrganizationId=${parentId}`,
      `exactOrganizationId=${parentId}&exactTenantId=${tenantId}`,
      `exactOrganizationId=${parentId}&exactTenantId=${randomUUID()}`,
    ]) {
      const qualified = await apiRequestWithSelectedOrg(request, 'GET', `/api/customers/people?id=${childPersonId}&${exact}`, { token, selectedOrgId: parentId })
      expect(qualified.status()).toBe(200)
      expect((await readJsonSafe<List>(qualified))?.items).toEqual([])
    }
    const created = await apiRequestWithSelectedOrg(request, 'POST', '/api/documents', { token, selectedOrgId: parentId, data: { title: `Exact document ${tag}`, folderId: null } })
    expect(created.status()).toBe(201)
    documentId = expectId((await readJsonSafe<Mutation>(created))?.id, 'Document ID')
    for (const [entityId, status] of [[childPersonId, 400], [parentPersonId, 201]] as const) {
      const linked = await apiRequestWithSelectedOrg(request, 'POST', `/api/documents/${documentId}/links`, {
        token, selectedOrgId: parentId,
        data: { entityType: 'customer-person', entityId, label: 'Untrusted label', href: `/backend/customers/people/${entityId}`, source: 'related-panel' },
      })
      expect(linked.status()).toBe(status)
    }
    const reverse = await apiRequestWithSelectedOrg(request, 'GET', `/api/documents?entityType=customer-person&entityId=${childPersonId}`, { token, selectedOrgId: parentId })
    expect(reverse.status()).toBe(403)
    const links = await apiRequestWithSelectedOrg(request, 'GET', `/api/documents/${documentId}/links`, { token, selectedOrgId: parentId })
    expect(links.status()).toBe(200)
    expect((await readJsonSafe<List>(links))?.items).toHaveLength(1)
  } finally {
    if (documentId) await withClient(async (client) => {
      await client.query('delete from document_entity_links where document_id = $1 and tenant_id = $2', [documentId, tenantId])
      await client.query('delete from document_contents where document_id = $1 and tenant_id = $2', [documentId, tenantId])
      await client.query('delete from documents where id = $1 and tenant_id = $2', [documentId, tenantId])
    })
    for (const personId of people) await withClient(async (client) => {
      await client.query('delete from customer_people where entity_id = $1 and tenant_id = $2', [personId, tenantId])
      await client.query('delete from customer_entities where id = $1 and tenant_id = $2', [personId, tenantId])
    })
    for (const organizationId of organizations.reverse()) await deleteOrganizationInDb(organizationId)
  }
})
