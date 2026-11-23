import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { setUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth', 'directory'] }

test('TC-CRM-8989: concurrent callers retain tenant and organization isolation', async ({ request }) => {
  const rootToken = await getAuthToken(request, 'superadmin')
  const marker = `tc8989-${randomUUID()}`
  const tenantIds: string[] = []
  const organizationIds: string[] = []
  const cleanup: { path: string; id: string; tenantId: string; organizationId?: string }[] = []
  const people: { id: string; token: string; tenantId: string; organizationId: string; displayName: string }[] = []
  const create = async (path: string, data: Record<string, unknown>, ids: string[]) => {
    const response = await apiRequest(request, 'POST', path, { token: rootToken, data })
    const body = await readJsonSafe<{ id?: string }>(response)
    if (typeof body?.id === 'string') {
      ids.push(body.id)
      cleanup.push({
        path, id: body.id,
        tenantId: typeof data.tenantId === 'string' ? data.tenantId : body.id,
        ...(path === '/api/directory/organizations' ? { organizationId: body.id } : {}),
      })
    }
    expect(response.status(), await response.text()).toBe(201)
    return expectId(body?.id, `${path} fixture id`)
  }
  try {
    await create('/api/directory/tenants', { name: `${marker}-first` }, tenantIds)
    await create('/api/directory/tenants', { name: `${marker}-second` }, tenantIds)
    for (const [index, tenantId] of [tenantIds[0], tenantIds[0], tenantIds[1]].entries()) {
      const organizationId = await create('/api/directory/organizations', { name: `${marker}-${index}`, tenantId }, organizationIds)
      const email = `${marker}-${index}@example.com`
      const password = customerTestPassword()
      const userId = await createUserFixture(request, rootToken, { email, password, organizationId, roles: [] })
      cleanup.push({ path: '/api/auth/users', id: userId, tenantId, organizationId })
      await setUserAclInDb({
        userId, tenantId, organizations: [organizationId], features: ['customers.people.view', 'customers.people.manage'],
      })
      const token = await getAuthToken(request, email, password)
      const displayName = `${marker}-${index}`
      const id = await createPersonFixture(request, token, { firstName: 'Concurrent', lastName: `${index}`, displayName })
      cleanup.push({ path: '/api/customers/people', id, tenantId, organizationId })
      people.push({ id, token, tenantId, organizationId, displayName })
    }
    const ids = people.map((person) => person.id).join(',')
    await Promise.all(people.map(async (actor) => {
      const headers = { Cookie: '' }
      await Promise.all([
        (async () => {
          const response = await apiRequest(request, 'GET', `/api/customers/people?ids=${ids}&pageSize=100`, { token: actor.token, headers })
          expect(response.status()).toBe(200)
          const body = await readJsonSafe<{ items: { id: string }[] }>(response)
          expect(body?.items.map((item) => item.id)).toEqual([actor.id])
        })(),
        ...people.map(async (person) => {
          const response = await apiRequest(request, 'GET', `/api/customers/people/${person.id}`, { token: actor.token, headers })
          if (person.id !== actor.id) {
            expect(response.status(), 'foreign tenant or organization person must be hidden').toBe(404)
            return
          }
          expect(response.status()).toBe(200)
          const body = await readJsonSafe<{ person: Record<string, unknown> }>(response)
          expect(body?.person).toMatchObject({ id: actor.id, displayName: actor.displayName, tenantId: actor.tenantId, organizationId: actor.organizationId })
        }),
      ])
    }))
  } finally {
    const failures: string[] = []
    for (const record of cleanup.reverse()) {
      try {
        const response = await apiRequest(request, 'DELETE', `${record.path}?id=${record.id}`, {
          token: rootToken,
          data: { id: record.id },
          headers: { Cookie: `om_selected_tenant=${record.tenantId}; om_selected_org=${record.organizationId ?? '__all__'}` },
        })
        if (!response.ok() && response.status() !== 404) failures.push(`${record.path}: ${response.status()}`)
      } catch {
        failures.push(`${record.path}: transport failure`)
      }
    }
    expect(failures, 'all created fixtures should be removed').toEqual([])
  }
})
