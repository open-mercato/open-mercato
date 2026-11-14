import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createFormFixture, deleteFormIfExists } from '@open-mercato/core/helpers/integration/formsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

for (const locale of ['en', 'pl']) {
  test(`TC-FORMS-UI-010: ${locale} metadata refusals never report saved`, async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    let formId: string | null = null
    const dictionary = JSON.parse(readFileSync(new URL(`../i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>
    try {
      const form = await createFormFixture(request, token, { name: 'Autosave status fixture', description: 'Original description' })
      formId = form.id
      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: locale, url: new URL(page.url()).origin }])
      await page.goto(`/backend/forms/${form.id}`, { waitUntil: 'domcontentloaded' })
      const configuration = page.getByRole('tab', { name: dictionary['forms.studio.palette.tabs.parameters'], exact: true })
      await expect(configuration).toBeVisible({ timeout: 60_000 })
      await configuration.click()
      const name = page.getByLabel(dictionary['forms.studio.parameters.name.label'], { exact: true })
      await expect(name).toHaveValue('Autosave status fixture')
      const header = page.locator('header').filter({ has: page.getByRole('link', { name: dictionary['forms.studio.actions.history'], exact: true }) })
      const path = `/api/forms/${form.id}`
      const readForm = async () => {
        const response = await apiRequest(request, 'GET', path, { token })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<Record<string, unknown>>(response)
        if (!body) throw new Error('[internal] Form detail response must contain a JSON object')
        return body
      }
      const changed = await apiRequest(request, 'PATCH', path, { token, data: { description: 'Concurrent editor description' } })
      expect(changed.status()).toBe(200)
      const concurrent = await readForm()

      for (const value of ['First stale name', 'Second stale name']) {
        const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === path && candidate.request().method() === 'PATCH')
        await name.fill(value)
        await expect(header.getByText(dictionary['forms.studio.autosave.saving'], { exact: true })).toBeVisible()
        expect((await response).status()).toBe(409)
        await expect(header.getByText(dictionary['forms.studio.autosave.error'], { exact: true })).toBeVisible()
        await expect(header.getByText(dictionary['forms.studio.autosave.idle'], { exact: true })).toHaveCount(0)
        const unchanged = await readForm()
        expect(unchanged).toEqual(concurrent)
      }

      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(configuration).toBeVisible({ timeout: 60_000 })
      await configuration.click()
      await expect(name).toHaveValue('Autosave status fixture')
      await expect(page.getByLabel(dictionary['forms.studio.parameters.description.label'], { exact: true })).toHaveValue('Concurrent editor description')
      const recovery = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === path && candidate.request().method() === 'PATCH')
      await name.fill('Recovered name')
      expect((await recovery).status()).toBe(200)
      await expect(header.getByText(dictionary['forms.studio.autosave.idle'], { exact: true })).toBeVisible()
      const saved = await readForm()
      expect(saved).toEqual({ ...concurrent, name: 'Recovered name', updatedAt: saved.updatedAt })
    } finally {
      await deleteFormIfExists(request, token, formId)
    }
  })
}
