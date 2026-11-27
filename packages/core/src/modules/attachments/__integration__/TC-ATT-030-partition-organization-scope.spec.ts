import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteAttachmentIfExists, deleteAttachmentPartitionIfExists, uploadAttachmentFixture,
} from '@open-mercato/core/helpers/integration/attachmentsFixtures'
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
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

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

test('TC-ATT-030: partition namespaces follow the owning scope', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(adminToken)
  const suffix = randomUUID().slice(0, 8)
  const code = `qa_scope_${suffix}`
  const cleanups: Array<() => Promise<unknown>> = []
  const partitionPath = '/api/attachments/partitions'
  type Partition = { id: string; code: string; title: string }
  const list = async (token: string) => {
    const response = await apiRequest(request, 'GET', partitionPath, { token })
    expect(response.status()).toBe(200)
    return (await readJsonSafe<{ items: Partition[] }>(response))?.items.filter((item) => item.code === code)
  }
  try {
    const newTenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: adminToken, data: { name: `QA partition tenant ${suffix}` },
    })
    expect(newTenant.status()).toBe(201)
    const secondTenantId = expectId((await readJsonSafe<{ id: string }>(newTenant))?.id, 'QA tenant id')
    cleanups.push(() => apiRequest(request, 'DELETE', '/api/directory/tenants', {
      token: adminToken, data: { id: secondTenantId },
    }))
    const created: Partition[] = []
    for (const [index, ownerTenantId] of [tenantId, tenantId, secondTenantId].entries()) {
      const title = `QA partition ${index} ${suffix}`
      const organizationId = await createOrganizationFixture(request, adminToken, { tenantId: ownerTenantId, name: title })
      cleanups.push(() => deleteOrganizationIfExists(request, adminToken, organizationId))
      const roleId = await createRoleFixture(request, adminToken, { tenantId: ownerTenantId, name: title })
      cleanups.push(() => deleteRoleIfExists(request, adminToken, roleId))
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['attachments.*'], organizations: [organizationId] })

      const email = `qa-partition-${index}-${suffix}@example.test`
      const password = `Qa1!${randomUUID()}`
      const user = await apiRequest(request, 'POST', '/api/auth/users', {
        token: adminToken, data: { email, password, tenantId: ownerTenantId, organizationId, roles: [roleId] },
      })
      expect(user.status()).toBe(201)
      const userId = expectId((await readJsonSafe<{ id: string }>(user))?.id, 'QA partition user id')
      cleanups.push(() => deleteUserIfExists(request, adminToken, userId))
      const token = await getAuthToken(request, email, password)
      expect(await list(token)).toEqual([])

      const create = () => apiRequest(request, 'POST', partitionPath, { token, data: { code, title, requiresOcr: false } })
      const first = await create()
      test.skip(index === 0 && first.status() === 403, 'Partition writes are disabled by the environment')
      expect(first.status()).toBe(201)
      const item = (await readJsonSafe<{ item: Partition }>(first))?.item
      if (!item) throw new Error('[internal] Missing created partition')
      created.push(item)
      cleanups.push(() => deleteAttachmentPartitionIfExists(request, token, item.id))
      expect(await list(token)).toEqual([expect.objectContaining({ id: item.id, code, title })])
      expect((await create()).status()).toBe(409)

      const file = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library', recordId: randomUUID(), partitionCode: code,
        fileName: 'qa.txt', mimeType: 'text/plain', buffer: Buffer.from(title),
      })
      cleanups.push(() => deleteAttachmentIfExists(request, token, file.id))
      const download = await apiRequest(request, 'GET', `/api/attachments/file/${file.id}`, { token })
      expect(download.status()).toBe(200)
      expect(await download.text()).toBe(title)
    }
    expect(new Set(created.map(({ id }) => id)).size).toBe(3)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
})
