import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createCustomEntity, deleteCustomEntityIfExists, saveFieldDefinitions, uniqueEntityId } from '@open-mercato/core/modules/entities/__integration__/helpers/entitiesApi'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

export const integrationMeta = { dependsOnModules: ['translations', 'entities'] }

test('TC-TRANS-021: injected field action saves labels, descriptions and option translations', async ({ page, request, baseURL }) => {
  const token = await getAuthToken(request, 'superadmin')
  const originalLocales = await getLocales(request, token)
  const entityId = uniqueEntityId('translated_fields')
  const fieldKey = 'status'
  const recordId = `${entityId}:${fieldKey}`

  try {
    await setLocales(request, token, [...new Set([...originalLocales, 'de'])])
    expect((await createCustomEntity(request, token, { entityId, label: 'QA translated fields' })).status()).toBe(200)
    expect((await saveFieldDefinitions(request, token, entityId, [{
      key: fieldKey,
      kind: 'select',
      configJson: { label: 'Status label', description: 'Status help', options: [{ value: 'new', label: 'New status' }] },
    }])).status()).toBe(200)

    await login(page, 'superadmin')
    expect(baseURL).toBeTruthy()
    await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL! }])
    await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}`)
    await expect(page.getByPlaceholder('snake_case', { exact: true })).toHaveValue(fieldKey)
    const definitionWrites: string[] = []
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/api/entities/definitions.batch') {
        definitionWrites.push(sent.method())
      }
    })
    const addOption = page.getByRole('button', { name: 'Add option', exact: true })
    await addOption.click()
    const optionDialog = page.getByRole('dialog', { name: 'Add option', exact: true })
    await expect(optionDialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(optionDialog).toBeHidden()
    await expect(addOption).toBeFocused()
    expect(definitionWrites).toEqual([])

    await page.getByRole('button', { name: 'Translate field', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Translate field: ${fieldKey}`, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: 'DE', exact: true }).click()
    await dialog.getByPlaceholder('Status label', { exact: true }).fill('Statusbezeichnung')
    await dialog.getByPlaceholder('Status help', { exact: true }).fill('Statushilfe')
    await dialog.getByPlaceholder('New status', { exact: true }).fill('Neuer Status')
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
      && decodeURIComponent(new URL(response.url()).pathname) === `/api/translations/entities:custom_field_def/${recordId}`)
    await dialog.getByRole('button', { name: 'Save translations', exact: true }).click()
    expect((await saved).ok()).toBe(true)

    const translated = await apiRequest(request, 'GET', `/api/translations/entities:custom_field_def/${encodeURIComponent(recordId)}`, { token })
    expect(translated.ok()).toBe(true)
    const body = await readJsonSafe<{ translations?: Record<string, Record<string, string>> }>(translated)
    expect(body?.translations?.de).toEqual({
      label: 'Statusbezeichnung',
      description: 'Statushilfe',
      'options.new.label': 'Neuer Status',
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await deleteTranslationIfExists(request, token, 'entities:custom_field_def', recordId)
    await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key: fieldKey } }).catch(() => undefined)
    await deleteCustomEntityIfExists(request, token, entityId)
    await setLocales(request, token, originalLocales)
  }
})
