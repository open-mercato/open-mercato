import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture,
  deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCustomEntity, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

test('TC-ENTITIES-9106: selected organization scopes relation labels without widening a finite organization grant', async ({ request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(administrator)
  const entityId = uniqueEntityId('relation_selected_org')
  const organizations: string[] = []
  const users: string[] = []
  const fixtures: Array<{ token: string; recordId: string; label: string; entityCreated: boolean; fieldCreated: boolean; recordCreated: boolean }> = []
  let roleId: string | null = null

  try {
    for (const name of ['Home', 'Selected']) {
      organizations.push(await createOrganizationFixture(request, administrator, { name: `Relation ${name} ${randomUUID()}`, tenantId }))
    }
    roleId = await createRoleFixture(request, administrator, { name: `relation-scope-${randomUUID()}`, tenantId })
    await setRoleAclFeatures(request, administrator, {
      roleId, organizations,
      features: ['entities.definitions.view', 'entities.definitions.manage', 'entities.records.view', 'entities.records.manage'],
    })

    for (const [index, organizationId] of organizations.entries()) {
      const email = `relation-scope-${randomUUID()}@example.test`
      const password = `Test-${randomUUID()}!`
      users.push(await createUserFixture(request, administrator, { email, password, organizationId, roles: [roleId] }))
      const token = await getAuthToken(request, email, password)
      const fixture = { token, recordId: randomUUID(), label: `Scope ${index}`, entityCreated: false, fieldCreated: false, recordCreated: false }
      fixtures.push(fixture)
      expect((await createCustomEntity(request, token, { entityId, label: 'Selected organization relation fixture', accessRestricted: false })).status()).toBe(200)
      fixture.entityCreated = true
      expect((await saveFieldDefinitions(request, token, entityId, [{ key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true } }])).status()).toBe(200)
      fixture.fieldCreated = true
      expect((await apiRequest(request, 'POST', '/api/entities/records', {
        token, data: { entityId, recordId: fixture.recordId, values: { title: fixture.label } },
      })).status()).toBe(200)
      fixture.recordCreated = true
    }

    const home = fixtures[0]
    const selected = fixtures[1]
    const path = `/api/entities/relations/options?entityId=${entityId}&labelField=title&ids=${home.recordId},${selected.recordId}`
    const own = await apiRequest(request, 'GET', path, { token: home.token })
    expect(own.status()).toBe(200)
    expect(await own.json()).toEqual({ items: [{ value: home.recordId, label: home.label }] })

    const switched = await apiRequest(request, 'GET', path, {
      token: home.token, headers: { Cookie: `om_selected_org=${organizations[1]}` },
    })
    expect(switched.status()).toBe(200)
    expect(await switched.json()).toEqual({ items: [{ value: selected.recordId, label: selected.label }] })

    const control = await apiRequest(request, 'GET', path, { token: selected.token })
    expect(control.status()).toBe(200)
    expect(await control.json()).toEqual({ items: [{ value: selected.recordId, label: selected.label }] })

    const restrictedAll = await apiRequest(request, 'GET', path, { token: home.token, headers: { Cookie: 'om_selected_org=__all__' } })
    expect(restrictedAll.status()).toBe(200)
    expect(await restrictedAll.json()).toEqual({ items: [{ value: home.recordId, label: home.label }] })

    const all = await apiRequest(request, 'GET', path, { token: administrator, headers: { Cookie: 'om_selected_org=__all__' } })
    expect(all.status()).toBe(200)
    const allBody = await all.json() as { items: Array<{ value: string; label: string }> }
    expect(allBody.items).toHaveLength(2)
    expect(allBody.items).toEqual(expect.arrayContaining([
      { value: home.recordId, label: home.label }, { value: selected.recordId, label: selected.label },
    ]))

    const rejected = await apiRequest(request, 'GET', path, {
      token: home.token, headers: { Cookie: `om_selected_org=${randomUUID()}` },
    })
    expect(rejected.status()).toBe(403)
  } finally {
    const cleanup = await Promise.allSettled(fixtures.map(async (fixture) => {
      if (fixture.recordCreated) expect((await apiRequest(request, 'DELETE', '/api/entities/records', { token: fixture.token, data: { entityId, recordId: fixture.recordId } })).status()).toBe(200)
      if (fixture.fieldCreated) expect((await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: fixture.token, data: { entityId, key: 'title' } })).status()).toBe(200)
      if (fixture.entityCreated) expect((await apiRequest(request, 'DELETE', '/api/entities/entities', { token: fixture.token, data: { entityId } })).status()).toBe(200)
    }))
    await Promise.all(users.map((userId) => deleteUserIfExists(request, administrator, userId)))
    await deleteRoleIfExists(request, administrator, roleId)
    await Promise.all(organizations.map((organizationId) => deleteOrganizationIfExists(request, administrator, organizationId)))
    for (const result of cleanup) expect(result.status).toBe('fulfilled')
  }
})
