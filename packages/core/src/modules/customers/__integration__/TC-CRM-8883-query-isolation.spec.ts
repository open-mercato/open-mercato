import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory'] }

test('TC-CRM-8883: recurrence and search cannot widen interaction scope', async ({ request }) => {
  test.setTimeout(120_000)
  const rootToken = await getAuthToken(request, 'superadmin')
  const tenantIds = [randomUUID(), randomUUID()]
  const organizationIds: string[] = []
  const entityId = randomUUID()
  const otherEntityId = randomUUID()
  const marker = `tc8883-${randomUUID()}`
  const password = customerTestPassword()
  let userId: string | undefined
  const expected: string[] = []
  const expectedAll: string[] = []
  let ordinaryId: string | undefined
  try {
    await withClient(async (client) => {
      for (const tenantId of tenantIds) {
        await client.query('insert into tenants (id, name, is_active, created_at, updated_at) values ($1, $2, true, now(), now())', [tenantId, marker])
      }
    })
    for (const tenantId of [tenantIds[0], tenantIds[0], tenantIds[1]]) {
      organizationIds.push(await createOrganizationInDb({ name: marker, tenantId }))
    }
    const email = `${marker}@example.com`
    userId = await createUserFixture(request, rootToken, { email, password, organizationId: organizationIds[0], roles: [] })
    await setUserAclInDb({ userId, tenantId: tenantIds[0], features: ['customers.interactions.view'], organizations: [organizationIds[0]] })
    const token = await getAuthToken(request, email, password)
    await withClient(async (client) => {
      for (const id of [entityId, otherEntityId]) {
        await client.query("insert into customer_entities (id, tenant_id, organization_id, kind, display_name, is_active, created_at, updated_at) values ($1, $2, $3, 'person', $4, true, now(), now())", [id, tenantIds[0], organizationIds[0], marker])
      }
      const cases = [
        { visible: true, end: null },
        { visible: true, end: '2026-02-01T00:00:00Z' },
        { visible: true, end: '2026-03-01T00:00:00Z', type: 'email', visibility: 'shared' },
        { visible: true, end: null, type: 'email', visibility: 'private', author: userId },
        { tenant: tenantIds[1], org: organizationIds[2] },
        { org: organizationIds[1] },
        { deleted: true },
        { entity: otherEntityId },
        { inScope: true, end: '2026-01-31T23:59:59Z' },
        { inScope: true, rule: null, scheduled: '2026-02-03T00:00:00Z' },
        { inScope: true, scheduled: '2026-03-01T00:00:00Z' },
        { type: 'email', visibility: 'private', end: null },
      ]
      for (const fixture of cases) {
        const id = randomUUID()
        if (fixture.visible) expected.push(id)
        if (fixture.visible || fixture.inScope) expectedAll.push(id)
        if (fixture.rule === null) ordinaryId = id
        await client.query(
          `insert into customer_interactions
           (id, tenant_id, organization_id, entity_id, interaction_type, title, body, status, scheduled_at,
            recurrence_rule, recurrence_end, visibility, author_user_id, pinned, deleted_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, 'planned', $8, $9, $10, $11, $12, false, $13, now(), now())`,
          [id, fixture.tenant ?? tenantIds[0], fixture.org ?? organizationIds[0], fixture.entity ?? entityId,
            fixture.type ?? 'meeting', fixture.visible ? marker : 'unmatched', marker,
            fixture.scheduled ?? '2026-01-01T00:00:00Z', fixture.rule === null ? null : 'FREQ=DAILY',
            fixture.end === null ? null : fixture.end ?? '2026-03-01T00:00:00Z', fixture.visibility ?? null, fixture.author ?? null,
            fixture.deleted ? new Date() : null],
        )
      }
    })
    const headers = { Cookie: '' }
    for (const mode of ['recurrence', 'recurrence-search', 'search']) {
      for (const sortField of ['scheduledAt', 'title']) {
        const params = new URLSearchParams({ entityId, limit: '1', sortField })
        const allowedIds = mode === 'search' ? expectedAll : expected
        if (mode !== 'search') {
          params.set('recurrenceMasters', 'true')
          params.set('from', '2026-02-01')
          params.set('to', '2026-02-08')
        }
        if (mode !== 'recurrence') params.set('search', marker)
        const seen: string[] = []
        let cursor: string | undefined
        do {
          if (cursor) params.set('cursor', cursor)
          const response = await apiRequest(request, 'GET', `/api/customers/interactions?${params}`, { token, headers })
          expect(response.status()).toBe(200)
          const body = await readJsonSafe<{ items: { id: string }[]; nextCursor?: string }>(response)
          expect(body?.items).toHaveLength(1)
          for (const item of body?.items ?? []) {
            expect(allowedIds).toContain(item.id)
            expect(seen).not.toContain(item.id)
            seen.push(item.id)
          }
          cursor = body?.nextCursor
          expect(seen.length).toBeLessThanOrEqual(allowedIds.length)
        } while (cursor)
        expect(seen.sort()).toEqual([...allowedIds].sort())
      }
    }
    const ordinaryResponse = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${entityId}&from=2026-02-01&to=2026-02-08`, { token, headers })
    expect(ordinaryResponse.status()).toBe(200)
    expect(await readJsonSafe<{ items: { id: string }[] }>(ordinaryResponse)).toMatchObject({ items: [{ id: ordinaryId }] })
    const countsResponse = await apiRequest(request, 'GET', `/api/customers/interactions/counts?entityId=${entityId}`, { token, headers })
    expect(countsResponse.status()).toBe(200)
    expect(await readJsonSafe<{ result: { total: number; email: number } }>(countsResponse)).toMatchObject({ result: { total: 7, email: 2 } })
  } finally {
    await withClient(async (client) => {
      await client.query('delete from customer_interactions where tenant_id = any($1::uuid[])', [tenantIds])
      await client.query('delete from customer_entities where id = any($1::uuid[])', [[entityId, otherEntityId]])
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
