import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, readJsonSafe, deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'directory', 'configs'] }

const SETTINGS_PATH = '/api/configs/date-locale'

type TenantFixture = {
  tenantId?: string
  organizationId?: string
  roleId?: string
  userId?: string
  token?: string
}

type SettingsResponse = { settings: { timeZone: string | null } }

test.describe('TC-CONF-010: Tenant date settings isolation', () => {
  test('foreign scope supplied in query, body or cookies cannot read or modify another tenant', async ({ request }) => {
    test.setTimeout(120_000)
    const superadminToken = await getAuthToken(request, 'superadmin')
    const fixtures: TenantFixture[] = []

    try {
      for (const timeZone of ['Asia/Tokyo', 'Europe/Warsaw']) {
        const fixture: TenantFixture = {}
        fixtures.push(fixture)
        const suffix = randomUUID()
        const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
          token: superadminToken,
          headers: { Cookie: '' },
          data: { name: `QA CONF 010 ${suffix}` },
        })
        expect(tenantResponse.status()).toBe(201)
        fixture.tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant fixture id')
        fixture.organizationId = await createOrganizationFixture(request, superadminToken, {
          name: `QA CONF 010 Organization ${suffix}`,
          tenantId: fixture.tenantId,
        })
        fixture.roleId = await createRoleFixture(request, superadminToken, {
          name: `qa-conf-010-${suffix}`,
          tenantId: fixture.tenantId,
        })
        await setRoleAclFeatures(request, superadminToken, {
          roleId: fixture.roleId,
          features: ['configs.date_locale.view', 'configs.date_locale.manage'],
          organizations: [fixture.organizationId],
        })
        const email = `qa-conf-010-${suffix}@example.com`
        const password = customerTestPassword()
        fixture.userId = await createUserFixture(request, superadminToken, {
          email,
          password,
          organizationId: fixture.organizationId,
          roles: [fixture.roleId],
        })
        const loginResponse = await postForm(request, '/api/auth/login', {
          email,
          password,
          tenantId: fixture.tenantId,
        }, { headers: { Cookie: '' } })
        expect(loginResponse.status()).toBe(200)
        fixture.token = expectId((await readJsonSafe<{ token?: string }>(loginResponse))?.token, 'tenant user token')
        const saved = await apiRequest(request, 'PUT', SETTINGS_PATH, {
          token: fixture.token,
          headers: { Cookie: '' },
          data: { timeZone },
        })
        expect(saved.status()).toBe(200)
        expect((await readJsonSafe<SettingsResponse>(saved))?.settings.timeZone).toBe(timeZone)
      }

      const [first, second] = fixtures
      const firstToken = expectId(first?.token, 'first tenant user token')
      const secondToken = expectId(second?.token, 'second tenant user token')
      const secondTenantId = expectId(second?.tenantId, 'second tenant id')
      const secondOrganizationId = expectId(second?.organizationId, 'second organization id')
      const foreignScope = new URLSearchParams({ tenantId: secondTenantId, organizationId: secondOrganizationId })
      const foreignHeaders = { Cookie: `om_selected_tenant=${secondTenantId}; om_selected_org=${secondOrganizationId}` }

      const foreignQueryRead = await apiRequest(request, 'GET', `${SETTINGS_PATH}?${foreignScope}`, {
        token: firstToken,
        headers: { Cookie: '' },
      })
      expect(foreignQueryRead.status()).toBe(403)

      const cookieRead = await apiRequest(request, 'GET', SETTINGS_PATH, { token: firstToken, headers: foreignHeaders })
      expect([200, 403]).toContain(cookieRead.status())
      if (cookieRead.status() === 200) {
        expect((await readJsonSafe<SettingsResponse>(cookieRead))?.settings.timeZone).toBe('Asia/Tokyo')
      }

      const bodyWrite = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: firstToken,
        headers: { Cookie: '' },
        data: { tenantId: secondTenantId, organizationId: secondOrganizationId, timeZone: 'Pacific/Kiritimati' },
      })
      expect(bodyWrite.status()).toBe(403)
      const queryWrite = await apiRequest(request, 'PUT', `${SETTINGS_PATH}?${foreignScope}`, {
        token: firstToken,
        headers: { Cookie: '' },
        data: { timeZone: 'Pacific/Kiritimati' },
      })
      expect(queryWrite.status()).toBe(403)

      const cookieWrite = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: firstToken,
        headers: foreignHeaders,
        data: { timeZone: 'Pacific/Kiritimati' },
      })
      expect([200, 403]).toContain(cookieWrite.status())
      if (cookieWrite.status() === 200) {
        expect((await readJsonSafe<SettingsResponse>(cookieWrite))?.settings.timeZone).toBe('Pacific/Kiritimati')
      }

      const foreignRead = await apiRequest(request, 'GET', SETTINGS_PATH, {
        token: secondToken,
        headers: { Cookie: '' },
      })
      expect(foreignRead.status()).toBe(200)
      expect((await readJsonSafe<SettingsResponse>(foreignRead))?.settings.timeZone).toBe('Europe/Warsaw')
      const ownRead = await apiRequest(request, 'GET', SETTINGS_PATH, { token: firstToken, headers: { Cookie: '' } })
      expect(ownRead.status()).toBe(200)
      expect((await readJsonSafe<SettingsResponse>(ownRead))?.settings.timeZone).toBe(cookieWrite.status() === 200 ? 'Pacific/Kiritimati' : 'Asia/Tokyo')
    } finally {
      for (const fixture of fixtures.reverse()) {
        await deleteUserIfExists(request, superadminToken, fixture.userId ?? null)
        await deleteRoleIfExists(request, superadminToken, fixture.roleId ?? null)
        await deleteOrganizationIfExists(request, superadminToken, fixture.organizationId ?? null)
        if (fixture.tenantId) {
          await withClient(async (client) => {
            await client.query('delete from module_configs where tenant_id = $1 and module_id = $2 and name = $3', [fixture.tenantId, 'configs', 'date_locale'])
          })
        }
        await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', fixture.tenantId ?? null)
      }
    }
  })
})
