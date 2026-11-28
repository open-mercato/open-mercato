import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, createRoleFixture, createUserFixture, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

type Settings = {
  appUrl?: string
  panelPath: string
  strategies: { email: { enabled: boolean; from?: string; replyTo?: string; subjectPrefix?: string } }
}

export const integrationMeta = { dependsOnModules: ['notifications', 'auth', 'directory', 'configs'] }

test('TC-NOTIF-9136: tenant notification settings cannot change another tenant or instance defaults', async ({ request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const suffix = randomUUID()
  const fixtures: Array<{ tenantId: string; organizationId?: string; roleId?: string; userId?: string; token?: string }> = []
  try {
    for (const label of ['a', 'b']) {
      const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: administrator, data: { name: `QA notifications 9136 ${label} ${suffix}` },
      })
      expect(response.status()).toBe(201)
      const tenantId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture')
      const fixture: (typeof fixtures)[number] = { tenantId }
      fixtures.push(fixture)
      fixture.organizationId = await createOrganizationFixture(request, administrator, { name: `QA 9136 ${label} ${suffix}`, tenantId })
      fixture.roleId = await createRoleFixture(request, administrator, { name: `qa-9136-${label}-${suffix}`, tenantId })
      await setRoleAclFeatures(request, administrator, { roleId: fixture.roleId, features: ['notifications.*'] })
      const email = `qa-9136-${label}-${suffix}@example.com`
      const password = customerTestPassword()
      fixture.userId = await createUserFixture(request, administrator, { email, password, organizationId: fixture.organizationId, roles: [fixture.roleId] })
      fixture.token = await getAuthToken(request, email, password)
    }
    const readVersion = async (index: number): Promise<{ settings: Settings; updatedAt: string }> => {
      const response = await apiRequest(request, 'GET', '/api/notifications/settings', { token: fixtures[index].token! })
      expect(response.status()).toBe(200)
      const body = await readJsonSafe<{ settings: Settings; updatedAt: string }>(response)
      expect(body?.settings).toBeTruthy()
      expect(body?.updatedAt).toMatch(/^\d{4}-/)
      return body!
    }
    const read = async (index: number) => (await readVersion(index)).settings
    const inherited = await readVersion(0)
    const versionHeader = (version: string) => ({ 'x-om-ext-optimistic-lock-expected-updated-at': version })
    const firstOverrides = await Promise.all(['first', 'second'].map((label) => apiRequest(request, 'POST', '/api/notifications/settings', {
      token: fixtures[0].token!, headers: versionHeader(inherited.updatedAt),
      data: { strategies: { email: { replyTo: `${label}@example.com` } } },
    })))
    expect(firstOverrides.map((response) => response.status()).sort()).toEqual([200, 409])
    const afterOverride = await readVersion(0)
    const tenantSaves = await Promise.all(['third', 'fourth'].map((label) => apiRequest(request, 'POST', '/api/notifications/settings', {
      token: fixtures[0].token!, headers: versionHeader(afterOverride.updatedAt),
      data: { strategies: { email: { replyTo: `${label}@example.com` } } },
    })))
    expect(tenantSaves.map((response) => response.status()).sort()).toEqual([200, 409])
    const winnerIndex = tenantSaves.findIndex((response) => response.status() === 200)
    const savedWinner = await readVersion(0)
    expect(savedWinner.settings.strategies.email.replyTo).toBe(`${['third', 'fourth'][winnerIndex]}@example.com`)
    expect(savedWinner.updatedAt).not.toBe(afterOverride.updatedAt)
    for (const field of ['replyTo', 'from']) {
      for (const value of ['not-an-email', 'support@example.com\r\nBcc: attacker@example.com']) {
        const rejected = await apiRequest(request, 'POST', '/api/notifications/settings', {
          token: fixtures[0].token!, data: { strategies: { email: { [field]: value } } },
        })
        expect(rejected.status()).toBe(400)
        expect(await readVersion(0)).toEqual(savedWinner)
      }
    }
    const disabledInApp = await apiRequest(request, 'POST', '/api/notifications/settings', {
      token: fixtures[0].token!, data: { strategies: { database: { enabled: false } } },
    })
    expect(disabledInApp.status()).toBe(400)
    expect(await readVersion(0)).toEqual(savedWinner)
    const beforeA = await read(0)
    const beforeB = await read(1)
    const globalBefore = await withClient((client) => client.query<{ value_json: unknown }>(
      "select value_json from module_configs where module_id = 'notifications' and name = 'delivery_strategies' and tenant_id is null",
    ))
    const response = await apiRequest(request, 'POST', '/api/notifications/settings', {
      token: fixtures[0].token!,
      data: { panelPath: beforeA.panelPath, strategies: { email: { enabled: !beforeA.strategies.email.enabled, from: 'tenant-a@example.com', replyTo: 'reply-a@example.com', subjectPrefix: '[A]' } } },
    })
    expect(response.status()).toBe(200)
    expect((await read(0)).strategies.email).toMatchObject({ enabled: !beforeA.strategies.email.enabled, from: 'tenant-a@example.com', replyTo: 'reply-a@example.com', subjectPrefix: '[A]' })
    expect(await read(1)).toEqual(beforeB)
    const savedA = await read(0)
    const spoofed = await apiRequest(request, 'POST', '/api/notifications/settings', {
      token: fixtures[0].token!,
      data: { tenantId: fixtures[1].tenantId, panelPath: '/backend/alerts' },
    })
    expect(spoofed.status()).toBe(403)
    expect(await read(0)).toEqual(savedA)
    expect(await read(1)).toEqual(beforeB)
    for (const appUrl of ['https://attacker.example', 'https://operator.example@attacker.example']) {
      const rejected = await apiRequest(request, 'POST', '/api/notifications/settings', { token: fixtures[0].token!, data: { appUrl } })
      expect(rejected.status()).toBe(400)
      expect(await read(0)).toEqual(savedA)
      expect(await read(1)).toEqual(beforeB)
    }
    const globalAfter = await withClient((client) => client.query<{ value_json: unknown }>(
      "select value_json from module_configs where module_id = 'notifications' and name = 'delivery_strategies' and tenant_id is null",
    ))
    expect(globalAfter.rows).toEqual(globalBefore.rows)
  } finally {
    for (const fixture of fixtures.reverse()) {
      await withClient(async (client) => {
        await client.query("delete from module_configs where module_id = 'notifications' and name = 'delivery_strategies' and tenant_id = $1", [fixture.tenantId])
      })
      const headers = { Cookie: `om_selected_tenant=${fixture.tenantId}${fixture.organizationId ? `; om_selected_org=${fixture.organizationId}` : ''}` }
      for (const [endpoint, id] of [
        ['/api/auth/users', fixture.userId], ['/api/auth/roles', fixture.roleId],
        ['/api/directory/organizations', fixture.organizationId], ['/api/directory/tenants', fixture.tenantId],
      ]) {
        if (!id) continue
        const response = await apiRequest(request, 'DELETE', `${endpoint}?id=${encodeURIComponent(id)}`, { token: administrator, headers })
        expect([200, 404]).toContain(response.status())
      }
    }
  }
})
