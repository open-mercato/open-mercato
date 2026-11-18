import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

test.describe('TC-AUTH-8700: role create validation', () => {
  for (const { locale, message } of [
    { locale: 'en', message: 'A role with this name already exists' },
    { locale: 'pl', message: 'Rola o tej nazwie już istnieje' },
  ]) {
    test(`retains the ${locale} create form after duplicate refusal and saves a corrected name`, async ({ page }, testInfo) => {
      const token = await getAuthToken(page.request, 'admin')
      const stamp = randomUUID()
      const occupied = `QA8700 occupied ${stamp}`
      const corrected = `QA8700 corrected ${stamp}`
      const roleIds: string[] = []
      try {
        roleIds.push(await createRoleFixture(page.request, token, { name: occupied }))
        await login(page, 'admin')
        expect((await page.request.post('/api/auth/locale', { data: { locale } })).status()).toBe(200)
        if (locale === 'pl') await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/backend/roles/create')
        const name = page.getByRole('main').getByRole('textbox').first()
        await fillControlledInput(name, occupied)
        const refusal = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/auth/roles' && response.request().method() === 'POST')
        await name.press('Control+Enter')
        const response = await refusal
        expect(response.status()).toBe(400)
        expect(await response.json()).toMatchObject({ fieldErrors: { name: message } })
        await expect(page.getByText(message, { exact: true }).first()).toBeVisible()
        await expect(name).toHaveValue(occupied)
        await expect(page).toHaveURL((url) => url.pathname === '/backend/roles/create')
        await testInfo.attach(`duplicate-role-${locale}`, { body: await page.screenshot(), contentType: 'image/png' })

        await fillControlledInput(name, corrected)
        const retry = page.waitForResponse((result) =>
          new URL(result.url()).pathname === '/api/auth/roles' && result.request().method() === 'POST')
        await name.press('Control+Enter')
        const saved = await retry
        expect(saved.status()).toBe(201)
        const roleId = expectId(((await saved.json()) as { id?: string }).id, 'Corrected role id')
        roleIds.push(roleId)
        await expect(page).toHaveURL((url) => url.pathname === '/backend/roles')
        const persisted = await apiRequest(page.request, 'GET', `/api/auth/roles?id=${roleId}&search=${encodeURIComponent(corrected)}`, { token })
        expect(await readJsonSafe(persisted)).toMatchObject({ items: [expect.objectContaining({ id: roleId, name: corrected })] })

        await page.goto('/backend/roles/create')
        await fillControlledInput(page.getByRole('main').getByRole('textbox').first(), `${corrected} cancelled`)
        await page.getByRole('main').getByRole('link', { name: locale === 'pl' ? 'Anuluj' : 'Cancel', exact: true }).first().click()
        await page.getByRole('alertdialog').getByRole('button', { name: locale === 'pl' ? 'Potwierdź' : 'Confirm', exact: true }).click()
        await expect(page).toHaveURL((url) => url.pathname === '/backend/roles')
        const cancelled = await apiRequest(page.request, 'GET', `/api/auth/roles?search=${encodeURIComponent(`${corrected} cancelled`)}`, { token })
        expect(await readJsonSafe(cancelled)).toMatchObject({ items: [] })
      } finally {
        await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
        for (const roleId of roleIds.reverse()) await deleteRoleIfExists(page.request, token, roleId)
      }
    })
  }

  test('allows the same name in an authorized foreign tenant and refuses a read-only actor', async ({ request }) => {
    const admin = await getAuthToken(request, 'admin')
    const superadmin = await getAuthToken(request, 'superadmin')
    const { organizationId } = getTokenContext(admin)
    const stamp = randomUUID()
    const name = `QA8700 shared ${stamp}`
    const roleIds: string[] = []
    let tenantId: string | null = null
    let userId: string | null = null
    try {
      roleIds.push(await createRoleFixture(request, admin, { name }))
      const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superadmin, data: { name: `QA8700 tenant ${stamp}` } })
      expect(tenant.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id?: string }>(tenant))?.id, 'Owned tenant id')
      roleIds.push(await createRoleFixture(request, superadmin, { name, tenantId }))

      const readerRole = await createRoleFixture(request, admin, { name: `QA8700 reader ${stamp}` })
      roleIds.push(readerRole)
      await setRoleAclFeatures(request, admin, { roleId: readerRole, features: ['auth.roles.list'], organizations: [organizationId] })
      const email = `qa8700-${stamp}@example.com`
      const password = `Qa8700!${randomUUID()}`
      userId = await createUserFixture(request, admin, { email, password, organizationId, roles: [readerRole] })
      const reader = await getAuthToken(request, email, password)
      const denied = await apiRequest(request, 'POST', '/api/auth/roles', { token: reader, data: { name: `QA8700 denied ${stamp}` } })
      expect(denied.status()).toBe(403)
      const absent = await apiRequest(request, 'GET', `/api/auth/roles?search=${encodeURIComponent(`QA8700 denied ${stamp}`)}`, { token: admin })
      expect(await readJsonSafe(absent)).toMatchObject({ items: [] })
    } finally {
      await deleteUserIfExists(request, admin, userId)
      for (const roleId of roleIds.reverse()) await deleteRoleIfExists(request, superadmin, roleId)
      await deleteGeneralEntityIfExists(request, superadmin, '/api/directory/tenants', tenantId)
    }
  })
})
