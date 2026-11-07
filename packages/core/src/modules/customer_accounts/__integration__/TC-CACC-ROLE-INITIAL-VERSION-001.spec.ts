import { expect, test, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { createCustomerRoleFixture, deleteCustomerRoleFixture } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

for (const legacyNullVersion of [false, true]) {
  test(`TC-CACC-ROLE-INITIAL-VERSION-001: ${legacyNullVersion ? 'legacy null' : 'new'} role rejects a stale first UI edit`, async ({ request, browser }, testInfo) => {
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const suffix = randomUUID()
    const userIds: string[] = []
    const contexts: BrowserContext[] = []
    let staffRoleId: string | null = null
    let customerRoleId: string | null = null
    const baseURL = process.env.BASE_URL || 'http://localhost:3000'
    try {
      staffRoleId = await createRoleFixture(request, admin, { name: `Version editors ${suffix}`, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, admin, {
        roleId: staffRoleId,
        features: ['customer_accounts.view', 'customer_accounts.roles.manage'],
      })
      const tokens: string[] = []
      for (const actor of ['first', 'second']) {
        const email = `role-version-${actor}-${suffix}@example.test`
        const password = `Version1!${randomUUID()}`
        userIds.push(await createUserFixture(request, admin, {
          email, password, organizationId: scope.organizationId, roles: [staffRoleId], name: actor,
        }))
        tokens.push(await getAuthToken(request, email, password))
      }
      const role = await createCustomerRoleFixture(request, admin)
      customerRoleId = role.id
      await withClient(async (client) => {
        const stored = await client.query<{ updated_at: string | null }>('select updated_at from customer_roles where id = $1', [role.id])
        expect(stored.rows[0].updated_at).not.toBeNull()
        if (legacyNullVersion) await client.query('update customer_roles set updated_at = null where id = $1', [role.id])
      })
      const detailPath = `/api/customer_accounts/admin/roles/${role.id}`
      const initial = await apiRequest(request, 'GET', detailPath, { token: tokens[0] })
      expect(initial.status()).toBe(200)
      const initialBody = await readJsonSafe<{ updatedAt: string }>(initial)
      expect(typeof initialBody?.updatedAt).toBe('string')
      const initialVersion = initialBody!.updatedAt
      const listing = await apiRequest(request, 'GET', `/api/customer_accounts/admin/roles?search=${encodeURIComponent(role.slug)}`, { token: tokens[0] })
      expect(listing.status()).toBe(200)
      const listBody = await readJsonSafe<{ items: Array<{ id: string; updatedAt: string }> }>(listing)
      expect(listBody?.items.find((item) => item.id === role.id)?.updatedAt).toBe(initialVersion)
      const actorContext = await browser.newContext({ baseURL, locale: 'en-US' })
      contexts.push(actorContext)
      await actorContext.addCookies([{ name: 'auth_token', value: tokens[0], url: baseURL }])
      const page = await actorContext.newPage()
      await acknowledgeGlobalNotices(page)
      await page.goto(`/backend/customer_accounts/roles/${role.id}`)
      const name = page.locator('[data-crud-field-id="name"]').getByRole('textbox')
      await expect(name).toHaveValue(role.name)
      const description = `Second actor description ${suffix}`
      const secondSave = await apiRequest(request, 'PUT', detailPath, {
        token: tokens[1], data: { description }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initialVersion },
      })
      expect(secondSave.status()).toBe(200)
      const secondBody = await readJsonSafe<{ updatedAt: string }>(secondSave)
      expect(secondBody?.updatedAt).not.toBe(initialVersion)
      const draftName = `First actor draft ${suffix}`
      await name.fill(draftName)
      const staleSave = page.waitForResponse((response) => new URL(response.url()).pathname === detailPath && response.request().method() === 'PUT')
      await page.locator('button[type="submit"]').first().click()
      const conflict = await staleSave
      expect(conflict.status()).toBe(409)
      expect(conflict.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(initialVersion)
      const conflictBody: unknown = await conflict.json()
      expect(conflictBody).toMatchObject({ code: 'optimistic_lock_conflict' })
      await expect(name).toHaveValue(draftName)
      const conflictScreenshot = testInfo.outputPath('role-stale-conflict.png')
      await page.screenshot({ path: conflictScreenshot, fullPage: true })
      await testInfo.attach('role stale conflict', { path: conflictScreenshot, contentType: 'image/png' })
      const persisted = await apiRequest(request, 'GET', detailPath, { token: tokens[1] })
      expect(await readJsonSafe<{ name: string; description: string }>(persisted)).toMatchObject({ name: role.name, description })
      for (const method of ['DELETE', 'PUT']) {
        const stale = await apiRequest(request, method, method === 'PUT' ? `${detailPath}/acl` : detailPath, {
          token: tokens[0], headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initialVersion },
          ...(method === 'PUT' ? { data: { features: [] } } : {}),
        })
        expect(stale.status()).toBe(409)
      }
      await page.reload()
      await expect(name).toHaveValue(role.name)
      await expect(page.locator('[data-crud-field-id="description"]').getByRole('textbox')).toHaveValue(description)
      await name.fill(draftName)
      const retry = page.waitForResponse((response) => new URL(response.url()).pathname === detailPath && response.request().method() === 'PUT')
      await page.locator('button[type="submit"]').first().click()
      expect((await retry).status()).toBe(200)
      const retried = await apiRequest(request, 'GET', detailPath, { token: tokens[1] })
      expect(await readJsonSafe<{ name: string; description: string }>(retried)).toMatchObject({ name: draftName, description })
    } finally {
      await Promise.allSettled(contexts.map((context) => context.close()))
      await deleteCustomerRoleFixture(request, admin, customerRoleId)
      for (const userId of userIds) await deleteUserIfExists(request, admin, userId)
      await deleteRoleIfExists(request, admin, staffRoleId)
    }
  })
}
