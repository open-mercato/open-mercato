import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('TC-ATT-030: each organization sees its own storage partitions and tenant-wide partitions', async ({ request }) => {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
  const suffix = randomUUID().slice(0, 8)
  const cleanups: Array<() => Promise<unknown>> = []
  const organizations: Array<{ id: string; token: string; partitionId: string }> = []
  const sharedPartitionId = randomUUID()

  try {
    for (const label of ['primary', 'secondary']) {
      const id = await createOrganizationFixture(request, superadminToken, {
        tenantId, name: `QA attachments ${label} ${suffix}`,
      })
      cleanups.push(() => deleteOrganizationIfExists(request, superadminToken, id))
      const roleId = await createRoleFixture(request, superadminToken, {
        tenantId, name: `QA partition manager ${label} ${suffix}`,
      })
      cleanups.push(() => deleteRoleIfExists(request, superadminToken, roleId))
      await setRoleAclFeatures(request, superadminToken, {
        roleId, features: ['attachments.manage'], organizations: [id],
      })
      const email = `qa-attachment-${label}-${suffix}@example.test`
      const password = `Qa1!${randomUUID()}`
      const userId = await createUserFixture(request, superadminToken, {
        email, password, organizationId: id, roles: [roleId],
      })
      cleanups.push(() => deleteUserIfExists(request, superadminToken, userId))
      organizations.push({
        id, token: await getAuthToken(request, email, password), partitionId: randomUUID(),
      })
    }

    const partitions = [
      ...organizations.map(({ id, partitionId }) => ({ id: partitionId, organizationId: id })),
      { id: sharedPartitionId, organizationId: null },
    ]
    cleanups.push(() => withClient((client) => client.query(
      'delete from attachment_partitions where id = any($1::uuid[])',
      [partitions.map(({ id }) => id)],
    )))
    for (const partition of partitions) {
      await withClient((client) => client.query(
        `insert into attachment_partitions
          (id, code, title, storage_driver, config_json, is_public, requires_ocr, tenant_id, organization_id, created_at, updated_at)
         values ($1, $2, $3, 'local', '{}'::jsonb, false, false, $4, $5, now(), now())`,
        [partition.id, `qa-${partition.id}`, 'QA partition scope fixture', tenantId, partition.organizationId],
      ))
    }

    for (const { token, partitionId } of organizations) {
      const response = await apiRequest(request, 'GET', '/api/attachments/partitions', { token })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ items: Array<{ id: string }> }>(response)
      const fixtureIds = new Set(partitions.map(({ id }) => id))
      const visibleIds = body?.items.filter(({ id }) => fixtureIds.has(id)).map(({ id }) => id)
      expect(visibleIds).toHaveLength(2)
      expect(visibleIds).toEqual(expect.arrayContaining([partitionId, sharedPartitionId]))
    }
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
})
