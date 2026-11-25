import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import english from '../i18n/en.json' with { type: 'json' }
import polish from '../i18n/pl.json' with { type: 'json' }
import { createCustomEntity, deleteCustomEntityIfExists, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

const apiHelpText = ['environment', 'list', 'read', 'readNote', 'create', 'createNote', 'update', 'delete', 'scope', 'rotate', 'protect'] as const

for (const [locale, dictionary] of [['en', english], ['pl', polish]] as const) {
  test(`custom entity help is localized in ${locale} on desktop and mobile`, async ({ page, baseURL }) => {
    await login(page, 'admin')
    await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL ?? 'http://localhost:3000' }])
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/backend/entities/user')
      const help = page.getByRole('button', { name: new RegExp(dictionary['entities.userEntities.help.title']) })
      await expect(help).toBeVisible()
      await help.click()
      await expect(help).toHaveAttribute('aria-expanded', 'true')
      for (const key of ['description', 'fields', 'create', 'api'] as const) {
        await expect(page.getByText(dictionary[`entities.userEntities.help.${key}`], { exact: true })).toBeVisible()
      }
      if (locale === 'pl') await expect(page.getByText(english['entities.userEntities.help.title'], { exact: true })).toHaveCount(0)
    }
  })

  test(`record list API help is localized in ${locale} on desktop and mobile`, async ({ page, request, baseURL }) => {
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('localized_help')
    const fieldKey = 'status'

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'Localized help fixture' })).ok()).toBe(true)
      expect((await saveFieldDefinitions(request, token, entityId, [
        { key: fieldKey, kind: 'text', configJson: { label: 'Status' } },
      ])).ok()).toBe(true)

      await login(page, 'admin')
      await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL ?? 'http://localhost:3000' }])
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`)
        const heading = dictionary['entities.userEntities.records.title'].replace('{{entityId}}', entityId)
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: dictionary['entities.userEntities.records.actions.editDefinition'], exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: dictionary['entities.userEntities.records.form.submitCreate'], exact: true })).toBeVisible()
        const help = page.getByRole('button').filter({ hasText: dictionary['entities.userEntities.records.apiHelp.title'] })
        await expect(help).toHaveAttribute('aria-expanded', 'false')
        await help.click()
        await expect(help).toHaveAttribute('aria-expanded', 'true')
        for (const key of ['intro', 'keyHelp', 'security'] as const) {
          await expect(page.getByText(dictionary[`entities.userEntities.records.apiHelp.${key}`])).toBeVisible()
        }
        for (const key of apiHelpText) {
          await expect(page.getByText(dictionary[`entities.userEntities.records.apiHelp.${key}`], { exact: true })).toBeVisible()
        }
        await expect(page.getByRole('link', { name: dictionary['entities.userEntities.records.apiHelp.guide'], exact: true })).toHaveAttribute('href', 'https://docs.openmercato.com/user-guide/api-keys')
        await expect(page.getByRole('link', { name: dictionary['entities.userEntities.records.apiHelp.cli'], exact: true })).toHaveAttribute('href', 'https://docs.openmercato.com/cli/api-keys')
        await expect(page.getByText(`export ENTITY_ID="${entityId}"`)).toBeVisible()
        if (locale === 'pl') {
          await expect(page.getByText(english['entities.userEntities.records.apiHelp.title'], { exact: true })).toHaveCount(0)
        }
      }
    } finally {
      await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key: fieldKey } }).catch(() => undefined)
      await deleteCustomEntityIfExists(request, token, entityId)
    }
  })
}
