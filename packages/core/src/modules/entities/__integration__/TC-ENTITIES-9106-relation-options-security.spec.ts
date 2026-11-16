import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCustomEntity, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

test('TC-ENTITIES-9106: metadata access cannot read system secrets; permitted relation labels remain available', async ({ request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const { organizationId } = getTokenContext(administrator)
  const entityId = uniqueEntityId('relation_label')
  const recordId = randomUUID()
  let roleId: string | null = null
  let userId: string | null = null
  let entityCreated = false
  let recordCreated = false
  let fieldCreated = false
  try {
    roleId = await createRoleFixture(request, administrator, { name: `relation-9106-${randomUUID()}` })
    await setRoleAclFeatures(request, administrator, { roleId, features: ['entities.definitions.view'] })
    const email = `relation-${randomUUID()}@example.test`
    const password = `Test-${randomUUID()}!`
    userId = await createUserFixture(request, administrator, { email, password, organizationId, roles: [roleId] })
    const actor = await getAuthToken(request, email, password)
    for (const target of ['security:user_mfa_method', 'auth:user', 'auth:session', 'directory:tenant', 'sales:sales_order']) {
      const response = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${target}&labelField=id`, { token: actor })
      expect(response.status(), `${target} must require its own read authority`).toBe(403)
    }
    const created = await createCustomEntity(request, administrator, { entityId, label: 'Relation security fixture' })
    expect(created.status()).toBe(200)
    entityCreated = true
    expect((await saveFieldDefinitions(request, administrator, entityId, [{ key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true } }])).status()).toBe(200)
    fieldCreated = true
    const record = await apiRequest(request, 'POST', '/api/entities/records', { token: administrator, data: { entityId, recordId, values: { title: 'Own relation label' } } })
    expect(record.status()).toBe(200)
    recordCreated = true
    const label = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${entityId}&labelField=title&ids=${recordId}`, { token: actor })
    expect(label.status()).toBe(200)
    expect(await label.json()).toEqual({ items: [{ value: recordId, label: 'Own relation label' }] })
    for (const field of ['secret', 'password_hash']) {
      const denied = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${entityId}&labelField=${field}`, { token: actor })
      expect(denied.status()).toBe(400)
    }
  } finally {
    if (recordCreated) await apiRequest(request, 'DELETE', '/api/entities/records', { token: administrator, data: { entityId, recordId } })
    if (fieldCreated) await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: administrator, data: { entityId, key: 'title' } })
    if (entityCreated) await apiRequest(request, 'DELETE', '/api/entities/entities', { token: administrator, data: { entityId } })
    await deleteUserIfExists(request, administrator, userId)
    await deleteRoleIfExists(request, administrator, roleId)
  }
})
