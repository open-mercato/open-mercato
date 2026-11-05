import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, deleteRoleIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const locales = [
  { locale: 'en', message: 'A role with this name already exists' },
  { locale: 'pl', message: 'Rola o tej nazwie już istnieje' },
]

test.describe('TC-AUTH-8707: localized role rename retry', () => {
  for (const { locale, message } of locales) {
    test(`shows Name validation and accepts a corrected same-form retry in ${locale}`, async ({ page }, testInfo) => {
      const token = await getAuthToken(page.request, 'admin')
      const stamp = randomUUID()
      const occupiedName = `QA 8707 occupied ${stamp}`
      const originalName = `QA 8707 original ${stamp}`
      const correctedName = `QA 8707 corrected ${stamp}`
      const roleIds: string[] = []

      try {
        roleIds.push(await createRoleFixture(page.request, token, { name: occupiedName }))
        const roleId = await createRoleFixture(page.request, token, { name: originalName })
        roleIds.push(roleId)
        await login(page, 'admin')
        const selectedLocale = await page.request.post('/api/auth/locale', { data: { locale } })
        expect(selectedLocale.status()).toBe(200)
        const editPath = `/backend/roles/${roleId}/edit`
        await page.goto(editPath)
        const nameInput = page.getByRole('main').getByRole('textbox').first()
        await expect(nameInput).toHaveValue(originalName)
        await fillControlledInput(nameInput, occupiedName)
        const rejectedResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/auth/roles' && response.request().method() === 'PUT')
        await nameInput.press('Control+Enter')
        const rejected = await rejectedResponse
        expect(rejected.status()).toBe(400)
        const rejectedBody: unknown = await rejected.json()
        expect(rejectedBody).toMatchObject({ fieldErrors: { name: message } })
        const version = rejected.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]
        expect(version).toBeTruthy()
        await expect(page.getByText(message, { exact: true }).first()).toBeVisible()
        expect(new URL(page.url()).pathname).toBe(editPath)
        const unchanged = await apiRequest(page.request, 'GET', `/api/auth/roles?id=${roleId}&search=${encodeURIComponent(originalName)}`, { token })
        expect(await readJsonSafe(unchanged)).toMatchObject({
          items: [expect.objectContaining({ id: roleId, name: originalName, updatedAt: version })],
        })
        await testInfo.attach(`duplicate-name-${locale}`, {
          body: await page.screenshot({ fullPage: false }), contentType: 'image/png',
        })

        await fillControlledInput(nameInput, correctedName)
        const retryResponse = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/auth/roles' && response.request().method() === 'PUT')
        await nameInput.press('Control+Enter')
        const retry = await retryResponse
        expect(retry.status()).toBe(200)
        expect(retry.request().headers()[OPTIMISTIC_LOCK_HEADER_NAME]).toBe(version)
        await expect(page).toHaveURL((url) => url.pathname === '/backend/roles')
        const saved = await apiRequest(page.request, 'GET', `/api/auth/roles?id=${roleId}&search=${encodeURIComponent(correctedName)}`, { token })
        expect(await readJsonSafe(saved)).toMatchObject({ items: [expect.objectContaining({ id: roleId, name: correctedName })] })
      } finally {
        await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
        for (const roleId of roleIds.reverse()) await deleteRoleIfExists(page.request, token, roleId)
      }
    })
  }
})
