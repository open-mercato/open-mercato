import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCustomEntity, expectUuid, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

test('TC-ENTITIES-9106: metadata access cannot read system secrets; permitted relation labels remain available', async ({ request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const { organizationId } = getTokenContext(administrator)
  const entityId = uniqueEntityId('relation_label')
  const recordId = randomUUID()
  let roleId: string | null = null
  let userId: string | null = null
  let readerRoleId: string | null = null
  let readerUserId: string | null = null
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
    for (const target of ['auth:user', 'auth:session', 'directory:tenant', 'sales:sales_order']) {
      const response = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${target}&labelField=id`, { token: actor })
      expect(response.status(), `${target} must require its own read authority`).toBe(403)
    }
    const optionalSecurityTarget = await apiRequest(request, 'GET', '/api/entities/relations/options?entityId=security:user_mfa_method&labelField=secret', { token: actor })
    expect([200, 403]).toContain(optionalSecurityTarget.status())
    if (optionalSecurityTarget.status() === 200) expect(await optionalSecurityTarget.json()).toEqual({ items: [] })
    const created = await createCustomEntity(request, administrator, { entityId, label: 'Relation security fixture' })
    expect(created.status()).toBe(200)
    entityCreated = true
    expect((await saveFieldDefinitions(request, administrator, entityId, [{ key: 'title', kind: 'text', configJson: { label: 'Title', formEditable: true } }])).status()).toBe(200)
    fieldCreated = true
    const record = await apiRequest(request, 'POST', '/api/entities/records', { token: administrator, data: { entityId, recordId, values: { title: 'Own relation label' } } })
    expect(record.status()).toBe(200)
    recordCreated = true
    const metadataOnly = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${entityId}&labelField=title&ids=${recordId}`, { token: actor })
    expect(metadataOnly.status()).toBe(403)
    readerRoleId = await createRoleFixture(request, administrator, { name: `relation-reader-9106-${randomUUID()}` })
    await setRoleAclFeatures(request, administrator, { roleId: readerRoleId, features: ['entities.definitions.view', 'entities.records.view'] })
    const readerEmail = `relation-reader-${randomUUID()}@example.test`
    readerUserId = await createUserFixture(request, administrator, { email: readerEmail, password, organizationId, roles: [readerRoleId] })
    const reader = await getAuthToken(request, readerEmail, password)
    const label = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${entityId}&labelField=title&ids=${recordId}`, { token: reader })
    expect(label.status()).toBe(200)
    expect(await label.json()).toEqual({ items: [{ value: recordId, label: 'Own relation label' }] })
    for (const field of ['secret', 'password_hash']) {
      const denied = await apiRequest(request, 'GET', `/api/entities/relations/options?entityId=${entityId}&labelField=${field}`, { token: reader })
      expect(denied.status()).toBe(400)
    }
  } finally {
    if (recordCreated) await apiRequest(request, 'DELETE', '/api/entities/records', { token: administrator, data: { entityId, recordId } })
    if (fieldCreated) await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: administrator, data: { entityId, key: 'title' } })
    if (entityCreated) await apiRequest(request, 'DELETE', '/api/entities/entities', { token: administrator, data: { entityId } })
    await deleteUserIfExists(request, administrator, userId)
    await deleteUserIfExists(request, administrator, readerUserId)
    await deleteRoleIfExists(request, administrator, roleId)
    await deleteRoleIfExists(request, administrator, readerRoleId)
  }
})

test('TC-ENTITIES-9106: product and portal user relation labels display and search by name', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  const suffix = randomUUID().slice(0, 8)
  const productTitle = `Atlas${suffix}`
  const userName = `Ada${suffix}`
  let productId: string | null = null
  let userId: string | null = null

  try {
    productId = await createProductFixture(request, token, { title: productTitle, sku: `QA-${suffix}` })
    const customer = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
      token,
      data: { email: `relation-${suffix}@example.test`, displayName: userName, password: `Test-${randomUUID()}!` },
    })
    expect(customer.status()).toBe(201)
    userId = expectUuid((await readJsonSafe<{ user: { id: string } }>(customer))?.user.id, 'created customer user id')

    for (const { entityId, id, label, selector } of [
      { entityId: 'catalog:catalog_product', id: productId, label: productTitle, selector: 'name' },
      { entityId: 'customer_accounts:customer_user', id: userId, label: userName, selector: 'displayName' },
    ]) {
      const lookups: Record<string, string>[] = [{ ids: id }, { ids: id, labelField: selector }, { q: label }]
      for (const lookup of lookups) {
        const params = new URLSearchParams({ entityId, ...lookup })
        const response = await apiRequest(request, 'GET', `/api/entities/relations/options?${params}`, { token })
        expect(response.status(), `${entityId} ${params}`).toBe(200)
        expect(await response.json()).toEqual({ items: [{ value: id, label }] })
      }
    }
  } finally {
    if (userId) await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${userId}`, { token })
    await deleteCatalogProductIfExists(request, token, productId)
  }
})
