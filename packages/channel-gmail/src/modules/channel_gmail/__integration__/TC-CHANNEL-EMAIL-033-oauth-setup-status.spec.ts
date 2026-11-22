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
import { deleteIntegrationCredentialsInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const oauthPath = '/api/communication_channels/oauth'
const credentialsPath = '/api/integrations/channel_gmail/credentials'

test('TC-CHANNEL-EMAIL-033: OAuth readiness is scoped and exposes only configuration status', async ({ request }) => {
  const statusPath = oauthPath + '/gmail/status'
  expect((await request.get(statusPath)).status()).toBe(401)

  const token = await getAuthToken(request, 'superadmin')
  const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token,
    data: { name: 'Mailbox setup ' + randomUUID() },
  })
  expect(tenantResponse.status()).toBe(201)
  const tenant = await readJsonSafe<{ id?: string }>(tenantResponse)
  const tenantId = expectId(tenant?.id, 'Tenant fixture must have an id')
  let configuredOrgId: string | null = null
  let otherOrgId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

  function scopedHeaders(organizationId: string): Record<string, string> {
    return {
      Authorization: 'Bearer ' + token,
      Cookie: 'om_selected_tenant=' + tenantId + '; om_selected_org=' + organizationId,
    }
  }

  try {
    configuredOrgId = await createOrganizationFixture(request, token, { name: 'Configured', tenantId })
    otherOrgId = await createOrganizationFixture(request, token, { name: 'Unconfigured', tenantId })
    const headers = scopedHeaders(configuredOrgId)
    const initial = await request.get(statusPath, { headers })
    expect(initial.status()).toBe(200)
    expect(await initial.json()).toEqual({ configured: false })

    const unknown = await request.get(oauthPath + '/missing-provider/status', { headers })
    expect(unknown.status()).toBe(404)

    const clientId = 'setup-fixture.apps.googleusercontent.com'
    const partial = await request.put(credentialsPath, { headers, data: { credentials: { clientId } } })
    expect(partial.status()).toBe(200)
    expect(await (await request.get(statusPath, { headers })).json()).toEqual({ configured: false })

    const save = await request.put(credentialsPath, {
      headers,
      data: { credentials: { clientId, clientSecret: randomUUID() } },
    })
    expect(save.status()).toBe(200)
    const readiness = await request.get(statusPath, { headers })
    expect(readiness.status()).toBe(200)
    expect(readiness.headers()['cache-control']).toContain('no-store')
    expect(readiness.headers()['set-cookie']).toBeUndefined()
    expect(await readiness.json()).toEqual({ configured: true })
    expect(await (await request.get(statusPath, { headers: scopedHeaders(otherOrgId) })).json())
      .toEqual({ configured: false })

    const initiate = await request.post(oauthPath + '/gmail/initiate', { headers, data: {} })
    expect(initiate.status()).toBe(200)
    const authorize = await readJsonSafe<{ authorizeUrl?: string }>(initiate)
    expect(authorize?.authorizeUrl).toMatch(/^https:\/\/accounts\.google\.com\//)

    roleId = await createRoleFixture(request, token, { name: 'mailbox-status-denied-' + randomUUID(), tenantId })
    await setRoleAclFeatures(request, token, {
      roleId,
      features: ['communication_channels.view'],
      organizations: [configuredOrgId],
    })
    const email = 'mailbox-status-denied-' + randomUUID() + '@example.test'
    const password = 'Qa-' + randomUUID() + '-Aa1!'
    userId = await createUserFixture(request, token, { email, password, organizationId: configuredOrgId, roles: [roleId] })
    const userToken = await getAuthToken(request, email, password)
    const denied = await apiRequest(request, 'GET', statusPath, { token: userToken })
    expect(denied.status()).toBe(403)
  } finally {
    await deleteUserIfExists(request, token, userId)
    await deleteRoleIfExists(request, token, roleId)
    await deleteIntegrationCredentialsInDb(configuredOrgId)
    await deleteOrganizationIfExists(request, token, otherOrgId)
    await deleteOrganizationIfExists(request, token, configuredOrgId)
    await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantId)
  }
})
