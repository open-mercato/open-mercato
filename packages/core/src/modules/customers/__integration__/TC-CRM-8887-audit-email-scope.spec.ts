import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory', 'audit_logs'] }

type AuditItem = {
  id: string
  snapshotBefore: { interactions: Array<{ title: string | null; body: string | null }> }
  snapshotAfter: { interactions: Array<{ title: string | null; body: string | null }> }
  changes: { interactions: { from: Array<{ title: string | null }>; to: Array<{ title: string | null }> } }
}

for (const kind of ['person', 'company'] as const) {
  test(`TC-CRM-8887: ${kind} audit JSON and CSV enforce live email authority and tenant/organization scope`, async ({ request }) => {
    const rootToken = await getAuthToken(request, 'superadmin')
    const tenantIds = [randomUUID(), randomUUID()]
    const organizationIds: string[] = []
    const entityIds = [randomUUID(), randomUUID(), randomUUID()]
    const marker = `audit8887-${randomUUID()}`
    const password = customerTestPassword()
    const cases = [
      { name: 'current-owner', visible: true },
      { name: 'current-grant', visible: true },
      { name: 'current-shared', visible: true },
      { name: 'foreign-organization-authority', visible: false },
      { name: 'foreign-tenant-authority', visible: false },
      { name: 'foreign-organization-grant', visible: false },
      { name: 'foreign-tenant-grant', visible: false },
      { name: 'missing-authority', visible: false },
      { name: 'deleted-authority', visible: false },
      { name: 'transferred-owner', visible: false },
    ].map((entry) => ({ ...entry, interactionId: randomUUID(), ownerId: randomUUID(), logId: randomUUID() }))
    const foreignLogIds: string[] = []
    let userId: string | undefined
    try {
      await withClient(async (client) => {
        for (const tenantId of tenantIds) {
          await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [tenantId, marker])
        }
      })
      for (const tenantId of [tenantIds[0], tenantIds[0], tenantIds[1]]) {
        organizationIds.push(await createOrganizationInDb({ name: marker, tenantId }))
      }
      const email = `${marker}@example.test`
      userId = await createUserFixture(request, rootToken, { email, password, organizationId: organizationIds[0], roles: [] })
      await setUserAclInDb({
        userId,
        tenantId: tenantIds[0],
        features: ['audit_logs.view_self', 'audit_logs.view_tenant'],
        organizations: [organizationIds[0]],
      })
      const token = await getAuthToken(request, email, password)
      await withClient(async (client) => {
        for (const [index, entityId] of entityIds.entries()) {
          await client.query(
            'insert into customer_entities (id, tenant_id, organization_id, kind, display_name, is_active, created_at, updated_at) values ($1, $2, $3, $4, $5, true, now(), now())',
            [entityId, index === 2 ? tenantIds[1] : tenantIds[0], organizationIds[index], kind, marker],
          )
        }
        for (const entry of cases) {
          const foreignOrganization = entry.name === 'foreign-organization-authority'
          const foreignTenant = entry.name === 'foreign-tenant-authority'
          const scopeIndex = foreignTenant ? 2 : foreignOrganization ? 1 : 0
          if (entry.name !== 'missing-authority') {
            await client.query(
              `insert into customer_interactions
               (id, tenant_id, organization_id, entity_id, interaction_type, visibility, author_user_id, status, pinned, deleted_at, created_at, updated_at)
               values ($1, $2, $3, $4, 'email', $5, $6, 'planned', false, $7, now(), now())`,
              [entry.interactionId, scopeIndex === 2 ? tenantIds[1] : tenantIds[0], organizationIds[scopeIndex], entityIds[scopeIndex],
                entry.name === 'current-shared' || foreignOrganization || foreignTenant || entry.name === 'deleted-authority' ? 'shared' : 'private',
                entry.name === 'current-owner' ? userId : entry.name === 'transferred-owner' ? randomUUID() : entry.ownerId,
                entry.name === 'deleted-authority' ? new Date() : null],
            )
          }
          if (['current-grant', 'foreign-organization-grant', 'foreign-tenant-grant', 'transferred-owner'].includes(entry.name)) {
            const grantIndex = entry.name === 'foreign-tenant-grant' ? 2 : entry.name === 'foreign-organization-grant' ? 1 : 0
            await client.query(
              `insert into customer_email_conversation_shares
               (id, tenant_id, organization_id, person_entity_id, owner_user_id, shared_by_user_id, created_at, updated_at)
               values ($1, $2, $3, $4, $5, $5, now(), now())`,
              [randomUUID(), grantIndex === 2 ? tenantIds[1] : tenantIds[0], organizationIds[grantIndex], entityIds[0], entry.ownerId],
            )
          }
          const before = { id: entry.interactionId, interactionType: 'email', authorUserId: entry.ownerId, title: `${marker}-${entry.name}-before`, body: `${marker}-${entry.name}-body-before` }
          const after = { ...before, title: `${marker}-${entry.name}-after`, body: `${marker}-${entry.name}-body-after` }
          await client.query(
            `insert into action_logs
             (id, tenant_id, organization_id, actor_user_id, command_id, action_label, resource_kind, resource_id,
              execution_state, snapshot_before, snapshot_after, changes_json, created_at, updated_at)
             values ($1, $2, $3, $4, 'customers.people.update', $5, $6, $7, 'done', $8::jsonb, $9::jsonb, $10::jsonb, now(), now())`,
            [entry.logId, tenantIds[0], organizationIds[0], entry.ownerId, marker, `customers.${kind}`, entityIds[0],
              JSON.stringify({ interactions: [before] }), JSON.stringify({ interactions: [after] }),
              JSON.stringify({ interactions: { from: [before], to: [after] } })],
          )
        }
        for (const scopeIndex of [1, 2]) {
          const id = randomUUID()
          foreignLogIds.push(id)
          await client.query(
            `insert into action_logs
             (id, tenant_id, organization_id, command_id, resource_kind, resource_id, execution_state, changes_json, created_at, updated_at)
             values ($1, $2, $3, 'customers.people.update', $4, $5, 'done', $6::jsonb, now(), now())`,
            [id, scopeIndex === 2 ? tenantIds[1] : tenantIds[0], organizationIds[scopeIndex], `customers.${kind}`, entityIds[0],
              JSON.stringify({ name: { from: 'before', to: `${marker}-foreign-history-${scopeIndex}` } })],
          )
        }
      })
      const params = new URLSearchParams({ resourceKind: `customers.${kind}`, resourceId: entityIds[0], pageSize: '100' })
      const headers = { Cookie: '' }
      const jsonResponse = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?${params}`, { token, headers })
      expect(jsonResponse.status()).toBe(200)
      const body = await readJsonSafe<{ items: AuditItem[] }>(jsonResponse)
      expect(body?.items.map((entry) => entry.id).sort()).toEqual(cases.map((entry) => entry.logId).sort())
      for (const entry of cases) {
        const item = body?.items.find((candidate) => candidate.id === entry.logId)
        expect(item, entry.name).toBeDefined()
        expect(item?.snapshotBefore.interactions[0].title, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-before` : null)
        expect(item?.snapshotBefore.interactions[0].body, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-body-before` : null)
        expect(item?.snapshotAfter.interactions[0].title, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-after` : null)
        expect(item?.snapshotAfter.interactions[0].body, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-body-after` : null)
        expect(item?.changes.interactions.from[0].title, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-before` : null)
        expect(item?.changes.interactions.to[0].title, entry.name).toBe(entry.visible ? `${marker}-${entry.name}-after` : null)
      }
      const csvResponse = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions/export?${params}`, { token, headers })
      expect(csvResponse.status()).toBe(200)
      const csv = await csvResponse.text()
      for (const entry of cases) {
        for (const side of ['before', 'after']) {
          for (const content of [`${marker}-${entry.name}-${side}`, `${marker}-${entry.name}-body-${side}`]) {
            if (entry.visible) expect(csv, entry.name).toContain(content)
            else expect(csv, entry.name).not.toContain(content)
          }
        }
      }
      expect(csv).not.toContain(`${marker}-foreign-history`)
      await withClient(async (client) => {
        const persisted = await client.query<{ id: string; snapshot_before: unknown }>(
          'select id, snapshot_before from action_logs where id = any($1::uuid[])', [cases.map((entry) => entry.logId)],
        )
        expect(persisted.rows).toHaveLength(cases.length)
        for (const entry of cases) {
          expect(JSON.stringify(persisted.rows.find((row) => row.id === entry.logId)?.snapshot_before)).toContain(`${marker}-${entry.name}-before`)
        }
        const foreignHistory = await client.query('select id from action_logs where id = any($1::uuid[])', [foreignLogIds])
        expect(foreignHistory.rows).toHaveLength(2)
      })
    } finally {
      await withClient(async (client) => {
        await client.query('delete from customer_email_conversation_shares where tenant_id = any($1::uuid[])', [tenantIds])
        await client.query('delete from customer_interactions where tenant_id = any($1::uuid[])', [tenantIds])
        await client.query('delete from customer_entities where id = any($1::uuid[])', [entityIds])
        await client.query('delete from action_logs where tenant_id = any($1::uuid[]) or actor_user_id = $2', [tenantIds, userId ?? null])
        await client.query('delete from entity_indexes where tenant_id = any($1::uuid[]) or entity_id = $2', [tenantIds, userId ?? null])
        await client.query('delete from search_tokens where tenant_id = any($1::uuid[])', [tenantIds])
        if (userId) {
          for (const table of ['sessions', 'user_acls', 'user_roles']) {
            await client.query(`delete from ${table} where user_id = $1`, [userId])
          }
          await client.query('delete from users where id = $1', [userId])
        }
        await client.query('delete from organizations where id = any($1::uuid[])', [organizationIds])
        await client.query('delete from tenants where id = any($1::uuid[])', [tenantIds])
      })
    }
  })
}
