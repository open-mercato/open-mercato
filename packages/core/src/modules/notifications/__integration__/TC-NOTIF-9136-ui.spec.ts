import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createOrganizationFixture, createRoleFixture, createUserFixture, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { customerTestPassword } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

export const integrationMeta = { dependsOnModules: ['notifications', 'auth', 'directory', 'configs'] }

test('TC-NOTIF-9136: settings recover from load failure, refuse stale browser saves, and email inbox opens', async ({ page, request }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const suffix = randomUUID()
  let tenantId: string | undefined
  let organizationId: string | undefined
  let roleId: string | undefined
  let userId: string | undefined
  try {
    const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', { token: administrator, data: { name: `QA notifications UI ${suffix}` } })
    expect(tenant.status()).toBe(201)
    tenantId = expectId((await readJsonSafe<{ id?: string }>(tenant))?.id, 'tenant fixture')
    organizationId = await createOrganizationFixture(request, administrator, { name: `QA notifications UI ${suffix}`, tenantId })
    roleId = await createRoleFixture(request, administrator, { name: `qa-notifications-ui-${suffix}`, tenantId })
    await setRoleAclFeatures(request, administrator, { roleId, features: ['notifications.*'] })
    const email = `qa-notifications-ui-${suffix}@example.com`
    const password = customerTestPassword()
    userId = await createUserFixture(request, administrator, { email, password, organizationId, roles: [roleId] })
    const token = await getAuthToken(request, email, password)
    const login = await page.request.post('/api/auth/login', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, data: new URLSearchParams({ email, password }).toString(),
    })
    expect(login.status()).toBe(200)
    const origin = new URL(login.url()).origin
    await page.context().addCookies([
      { name: 'om_selected_tenant', value: tenantId, url: origin },
      { name: 'om_selected_org', value: organizationId, url: origin },
    ])
    await acknowledgeGlobalNotices(page)
    await page.route('**/api/notifications/settings', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled settings failure' }) }))
    await page.goto('/backend/config/notifications')
    await expect(page.getByRole('alert').filter({ hasText: 'Controlled settings failure', has: page.getByRole('button', { name: /retry/i }) })).toBeVisible()
    await page.unroute('**/api/notifications/settings')
    await page.getByRole('button', { name: /retry/i }).click()
    await expect(page.locator('#notifications-email-reply')).toBeVisible()
    const otherActor = await apiRequest(request, 'POST', '/api/notifications/settings', {
      token, data: { strategies: { email: { replyTo: 'newer-actor@example.com' } } },
    })
    expect(otherActor.status()).toBe(200)
    await page.locator('#notifications-email-subject-prefix').fill('[stale browser]')
    const refused = page.waitForResponse((response) => response.url().endsWith('/api/notifications/settings') && response.request().method() === 'POST')
    await page.getByRole('button', { name: /save settings/i }).click()
    expect((await refused).status()).toBe(409)
    const persisted = await apiRequest(request, 'GET', '/api/notifications/settings', { token })
    expect((await readJsonSafe<{ settings: { strategies: { email: { replyTo: string } } } }>(persisted))?.settings.strategies.email.replyTo).toBe('newer-actor@example.com')
    for (const locale of ['en', 'pl']) {
      expect((await page.request.post('/api/auth/locale', { data: { locale } })).ok()).toBe(true)
      const inbox = await page.goto('/backend/notifications')
      expect(inbox?.status()).toBe(200)
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/backend$/)
    }
  } finally {
    await page.goto('about:blank')
    if (tenantId) await withClient((client) => client.query("delete from module_configs where module_id = 'notifications' and name = 'delivery_strategies' and tenant_id = $1", [tenantId]))
    const headers = { Cookie: `om_selected_tenant=${tenantId ?? ''}; om_selected_org=${organizationId ?? ''}` }
    for (const [endpoint, id] of [['/api/auth/users', userId], ['/api/auth/roles', roleId], ['/api/directory/organizations', organizationId], ['/api/directory/tenants', tenantId]]) {
      if (!id) continue
      const removed = await apiRequest(request, 'DELETE', `${endpoint}?id=${encodeURIComponent(id)}`, { token: administrator, headers })
      expect([200, 404]).toContain(removed.status())
    }
  }
})
