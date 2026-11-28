import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'

test('TC-QIDX-9134: a queued purge only removes the selected organization’s projections', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const setupToken = await getAuthToken(request, 'superadmin')
  const { tenantId, organizationId } = getTokenContext(token)
  const entityType = `qa:purge_${randomUUID()}`
  let otherOrganizationId: string | null = null

  const readOrganizationIds = () => withClient(async (client) => {
    const result = await client.query<{ organization_id: string }>(
      'select organization_id from entity_indexes where entity_type = $1 and tenant_id = $2',
      [entityType, tenantId],
    )
    return result.rows.map((row) => row.organization_id)
  })

  try {
    otherOrganizationId = await createOrganizationFixture(request, setupToken, {
      name: `Index purge control ${randomUUID()}`,
      tenantId,
    })
    await withClient(async (client) => {
      await client.query(
        `insert into entity_indexes
           (entity_type, entity_id, organization_id, tenant_id, doc, index_version, created_at, updated_at)
         values
           ($1, $2, $4, $6, '{}'::jsonb, 1, now(), now()),
           ($1, $3, $5, $6, '{}'::jsonb, 1, now(), now())`,
        [entityType, randomUUID(), randomUUID(), organizationId, otherOrganizationId, tenantId],
      )
    })
    expect(await readOrganizationIds()).toEqual(expect.arrayContaining([organizationId, otherOrganizationId]))

    const response = await apiRequest(request, 'POST', '/api/query_index/purge', {
      token,
      data: { entityType },
    })
    expect(response.ok(), `index purge responded with ${response.status()}`).toBeTruthy()
    await drainIntegrationQueue('events')
    await expect.poll(readOrganizationIds).toEqual([otherOrganizationId])
  } finally {
    try {
      await withClient(async (client) => {
        for (const table of ['entity_indexes', 'entity_index_jobs', 'entity_index_coverage', 'indexer_status_logs', 'indexer_error_logs']) {
          await client.query(`delete from ${table} where entity_type = $1 and tenant_id = $2`, [entityType, tenantId])
        }
      })
    } finally {
      await deleteOrganizationIfExists(request, setupToken, otherOrganizationId)
    }
  }
})
