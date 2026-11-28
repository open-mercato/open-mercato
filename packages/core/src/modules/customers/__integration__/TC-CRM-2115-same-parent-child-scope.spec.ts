import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { createOrganizationInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'audit_logs', 'query_index'] }

for (const kind of ['person', 'company'] as const) {
  test(`TC-CRM-2115: ${kind} snapshots and address undo isolate same-parent children by tenant and organization`, async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const foreignTenantId = randomUUID()
    const marker = `tc2115-${randomUUID()}`
    const foreignAddressIds: string[] = [randomUUID(), randomUUID()]
    const organizationIds: string[] = []
    const entityPath = `/api/customers/${kind === 'person' ? 'people' : 'companies'}`
    let entityId: string | null = null
    try {
      await withClient((client) => client.query(
        'insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())',
        [foreignTenantId, marker],
      ))
      organizationIds.push(await createOrganizationInDb({ name: `${marker}-sibling`, tenantId: scope.tenantId }))
      organizationIds.push(await createOrganizationInDb({ name: `${marker}-foreign`, tenantId: foreignTenantId }))
      entityId = kind === 'person'
        ? await createPersonFixture(request, token, { firstName: 'Scope', lastName: marker, displayName: marker })
        : await createCompanyFixture(request, token, marker)

      const addressIds: string[] = []
      for (const isPrimary of [true, false]) {
        const response = await apiRequest(request, 'POST', '/api/customers/addresses', {
          token, data: { entityId, addressLine1: `${marker}-${isPrimary}`, isPrimary },
        })
        expect(response.status()).toBe(201)
        addressIds.push(expectId((await readJsonSafe<{ id: string }>(response))?.id, 'address id'))
      }
      await withClient(async (client) => {
        for (const [index, tenantId] of [scope.tenantId, foreignTenantId].entries()) {
          await client.query(
            `insert into customer_addresses
             (id, entity_id, tenant_id, organization_id, address_line1, is_primary, created_at, updated_at)
             values ($1, $2, $3, $4, $5, true, now(), now())`,
            [foreignAddressIds[index], entityId, tenantId, organizationIds[index], marker],
          )
        }
      })

      const promotion = await apiRequest(request, 'PUT', '/api/customers/addresses', {
        token, data: { id: addressIds[1], isPrimary: true },
      })
      expect(promotion.status()).toBe(200)
      const promoted = expectOperation(promotion, 'same-parent address promotion')
      await withClient(async (client) => {
        const rows = await client.query<{ id: string; is_primary: boolean }>(
          'select id, is_primary from customer_addresses where entity_id = $1 order by id', [entityId],
        )
        expect(rows.rows.filter((row) => foreignAddressIds.includes(row.id))).toEqual(
          [...foreignAddressIds].sort().map((id) => ({ id, is_primary: true })),
        )
        expect(rows.rows.find((row) => row.id === addressIds[0])?.is_primary).toBe(false)
        expect(rows.rows.find((row) => row.id === addressIds[1])?.is_primary).toBe(true)
      })
      await undoOk(request, token, promoted.undoToken, 'same-parent address promotion')
      await withClient(async (client) => {
        const rows = await client.query<{ id: string; is_primary: boolean }>(
          'select id, is_primary from customer_addresses where entity_id = $1 order by id', [entityId],
        )
        expect(rows.rows.filter((row) => foreignAddressIds.includes(row.id))).toEqual(
          [...foreignAddressIds].sort().map((id) => ({ id, is_primary: true })),
        )
        expect(rows.rows.find((row) => row.id === addressIds[0])?.is_primary).toBe(true)
        expect(rows.rows.find((row) => row.id === addressIds[1])?.is_primary).toBe(false)
      })

      const updated = await apiRequest(request, 'PUT', entityPath, {
        token, data: { id: entityId, displayName: `${marker}-updated` },
      })
      expect(updated.status()).toBe(200)
      const operation = expectOperation(updated, 'scoped customer update')
      const query = new URLSearchParams({
        resourceKind: `customers.${kind}`, resourceId: entityId, organizationId: scope.organizationId, pageSize: '20',
      })
      const audit = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${query}`, { token })
      expect(audit.status()).toBe(200)
      const body = await readJsonSafe<{
        items?: Array<{
          id: string
          snapshotBefore?: { addresses?: Array<{ id: string }> }
          snapshotAfter?: { addresses?: Array<{ id: string }> }
        }>
      }>(audit)
      const entry = body?.items?.find((item) => item.id === operation.logId)
      expect(entry).toBeDefined()
      for (const snapshot of [entry?.snapshotBefore, entry?.snapshotAfter]) {
        expect(snapshot?.addresses?.map((address) => address.id).sort()).toEqual([...addressIds].sort())
      }
    } finally {
      await withClient((client) => client.query('delete from customer_addresses where id = any($1::uuid[])', [foreignAddressIds]))
      await deleteEntityIfExists(request, token, entityPath, entityId)
      await withClient(async (client) => {
        await client.query('delete from organizations where id = any($1::uuid[])', [organizationIds])
        await client.query('delete from tenants where id = $1', [foreignTenantId])
      })
    }
  })
}
