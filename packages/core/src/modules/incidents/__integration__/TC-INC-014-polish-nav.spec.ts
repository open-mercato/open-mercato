import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const requireJson = createRequire(import.meta.url)
const plDict = requireJson('../i18n/pl.json') as Record<string, string>
const enDict = requireJson('../i18n/en.json') as Record<string, string>

function translated(key: string): string {
  const value = plDict[key]
  expect(typeof value, `${key} should exist in pl.json`).toBe('string')
  expect(value, `${key} should not render as a raw incidents.* key`).not.toMatch(/^incidents\./)
  return value
}

function expectPolishValue(key: string): string {
  const value = translated(key)
  expect(value, `${key} should be translated in pl.json, not copied from en.json`).not.toBe(enDict[key])
  return value
}

async function expectNoRawIncidentKeys(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('body'), 'UI should not expose raw incidents.* keys').not.toContainText(/incidents\./)
}

test.describe('TC-INC-014: Polish incidents navigation and labels', () => {
  test('renders Polish nav, list columns, and create form labels without raw keys or English nav strings', async ({ page }) => {
    await login(page, 'admin')
    try {
      const localeResponse = await page.request.post('/api/auth/locale', {
        headers: { 'content-type': 'application/json' },
        data: { locale: 'pl' },
      })
      expect(localeResponse.ok(), 'switching locale to pl should succeed').toBeTruthy()

      const navLabel = expectPolishValue('incidents.nav.incidents')
      const navGroup = expectPolishValue('incidents.nav.group')
      const listColumnKeys = [
        'incidents.incident.list.columns.number',
        'incidents.incident.list.columns.title',
        'incidents.incident.list.columns.severity',
        'incidents.incident.list.columns.updated',
      ] as const
      const formFieldKeys = [
        'incidents.incident.form.fields.title',
        'incidents.incident.form.fields.severity',
        'incidents.incident.form.fields.description',
        'incidents.incident.form.fields.customerImpactSummary',
      ] as const

      await page.goto('/backend/incidents', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('link', { name: navLabel }).first(), 'incidents sidebar nav label should use pl.json').toBeVisible()
      await expect(page.getByText(navGroup, { exact: true }).first(), 'incidents sidebar group should use pl.json').toBeVisible()
      await expect(page.locator('body')).not.toContainText(/\bIncidents\b/)
      await expect(page.locator('body')).not.toContainText(/\bOperations\b/)
      await expectNoRawIncidentKeys(page)

      for (const key of listColumnKeys) {
        const label = expectPolishValue(key)
        await expect(page.getByText(label).first(), `${key} column header should use pl.json`).toBeVisible()
      }

      await page.goto('/backend/incidents/create', { waitUntil: 'domcontentloaded' })
      await expectNoRawIncidentKeys(page)
      await expect(page.locator('body')).not.toContainText(/\bIncidents\b/)
      await expect(page.locator('body')).not.toContainText(/\bOperations\b/)

      for (const key of formFieldKeys) {
        const label = expectPolishValue(key)
        await expect(page.getByText(label).first(), `${key} field label should use pl.json`).toBeVisible()
      }
    } finally {
      await page.request.post('/api/auth/locale', {
        headers: { 'content-type': 'application/json' },
        data: { locale: 'en' },
      }).catch(() => undefined)
    }
  })
})
