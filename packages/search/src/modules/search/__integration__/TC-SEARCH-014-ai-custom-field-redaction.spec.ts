import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type ToolResult = {
  success: boolean
  result?: { found: boolean; record?: Record<string, unknown>; customFields?: Record<string, unknown> }
}

async function createId(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>, headers?: Record<string, string>) {
  const response = await apiRequest(request, 'POST', path, { token, data, headers })
  expect(response.ok(), `${path}: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ id: string }>(response)
  expect(body?.id).toBeTruthy()
  return body!.id
}

test('TC-SEARCH-014: registered search_get redacts persisted sensitive custom fields and enforces access scopes', async ({ request }) => {
  const superadminToken = await getAuthToken(request, 'superadmin')
  const foreignTenantToken = await getAuthToken(request, 'admin')
  const marker = randomUUID()
  let tenantId: string | null = null
  const organizations: string[] = []
  const roles: string[] = []
  const users: string[] = []
  let recordId: string | null = null
  let ownerToken: string | null = null
  let profileId: string | null = null
  const entityId = 'customers:customer_person_profile'
  const definitions = [
    { key: 'ssn', kind: 'text' },
    { key: 'personal_email', kind: 'text' },
    { key: 'integration_safe_text', kind: 'text' },
    { key: 'integration_safe_score', kind: 'integer' },
    { key: 'integration_safe_flag', kind: 'boolean' },
  ]
  try {
    tenantId = await createId(request, superadminToken, '/api/directory/tenants', { name: `Search redaction ${marker}` })
    const headers = { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=__all__` }
    for (const label of ['owner', 'other']) {
      organizations.push(await createId(request, superadminToken, '/api/directory/organizations', { name: `${label} ${marker}`, tenantId }, headers))
    }
    const tokens: string[] = []
    for (const [index, features] of [
      ['ai_assistant.view', 'search.view', 'customers.*', 'entities.*'],
      ['ai_assistant.view', 'search.view'],
      ['ai_assistant.view', 'search.view', 'customers.people.view'],
    ].entries()) {
      const organizationId = organizations[index === 2 ? 1 : 0]
      const roleId = await createId(request, superadminToken, '/api/auth/roles', { name: `search-${index}-${marker}`, tenantId }, headers)
      roles.push(roleId)
      const acl = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken, headers, data: { roleId, features, organizations: [organizationId] },
      })
      expect(acl.status()).toBe(200)
      const email = `search-${index}-${marker}@example.com`
      const password = `Test-${randomUUID()}!`
      users.push(await createId(request, superadminToken, '/api/auth/users', { email, password, tenantId, organizationId, roles: [roleId] }, headers))
      tokens.push(await getAuthToken(request, email, password))
    }
    ownerToken = tokens[0]
    const definitionResponse = await apiRequest(request, 'POST', '/api/entities/definitions.batch', {
      token: ownerToken, data: { entityId, definitions: definitions.map((definition) => ({ ...definition, configJson: { label: definition.key } })) },
    })
    expect(definitionResponse.status()).toBe(200)
    const createPerson = await apiRequest(request, 'POST', '/api/customers/people', { token: ownerToken, data: {
      firstName: 'Search', lastName: marker, displayName: `Search ${marker}`,
      customFields: { ssn: 'private-ssn', personal_email: 'private@example.com', integration_safe_text: marker, integration_safe_score: 0, integration_safe_flag: false },
    } })
    expect(createPerson.status()).toBe(201)
    const person = await readJsonSafe<{ id: string; personId: string }>(createPerson)
    expect(person?.personId).toBeTruthy()
    recordId = person!.id
    profileId = person!.personId
    const persistedResponse = await apiRequest(request, 'GET', `/api/customers/people?ids=${recordId}`, { token: ownerToken })
    expect(persistedResponse.status()).toBe(200)
    const persisted = await readJsonSafe<{ items: Record<string, unknown>[] }>(persistedResponse)
    expect(persisted?.items).toHaveLength(1)
    expect(persisted?.items[0]).toMatchObject({ cf_ssn: 'private-ssn', cf_personal_email: 'private@example.com' })
    const execute = (token: string) => apiRequest(request, 'POST', '/api/ai_assistant/tools/execute', {
      token, data: { toolName: 'search_get', args: { entityType: entityId, recordId: profileId } },
    })
    const response = await execute(ownerToken)
    expect(response.status()).toBe(200)
    const body = await readJsonSafe<ToolResult>(response)
    expect(body?.success).toBe(true)
    expect(body?.result?.found).toBe(true)
    expect(body?.result?.customFields).toMatchObject({ integration_safe_text: marker, integration_safe_score: 0, integration_safe_flag: false })
    for (const field of ['ssn', 'personal_email']) {
      expect(body?.result?.customFields).not.toHaveProperty(field)
      expect(body?.result?.record).not.toHaveProperty(`cf_${field}`)
      expect(body?.result?.record).not.toHaveProperty(`cf:${field}`)
    }
    const denied = await execute(tokens[1])
    expect(denied.status()).toBe(400)
    expect((await readJsonSafe<ToolResult>(denied))?.success).toBe(false)
    for (const token of [tokens[2], foreignTenantToken]) {
      const outside = await execute(token)
      expect(outside.status()).toBe(200)
      expect((await readJsonSafe<ToolResult>(outside))?.result?.found).toBe(false)
    }
  } finally {
    if (ownerToken && recordId) await apiRequest(request, 'DELETE', `/api/customers/people?id=${recordId}`, { token: ownerToken }).catch(() => undefined)
    if (ownerToken) {
      for (const definition of definitions) await apiRequest(request, 'DELETE', '/api/entities/definitions', { token: ownerToken, data: { entityId, key: definition.key } }).catch(() => undefined)
    }
    const headers = tenantId ? { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=__all__` } : undefined
    for (const id of users.reverse()) await apiRequest(request, 'DELETE', `/api/auth/users?id=${id}`, { token: superadminToken, headers }).catch(() => undefined)
    for (const id of roles.reverse()) await apiRequest(request, 'DELETE', `/api/auth/roles?id=${id}`, { token: superadminToken, headers }).catch(() => undefined)
    for (const id of organizations.reverse()) await apiRequest(request, 'DELETE', '/api/directory/organizations', { token: superadminToken, headers, data: { id } }).catch(() => undefined)
    if (tenantId) await apiRequest(request, 'DELETE', '/api/directory/tenants', { token: superadminToken, data: { id: tenantId } }).catch(() => undefined)
  }
})
