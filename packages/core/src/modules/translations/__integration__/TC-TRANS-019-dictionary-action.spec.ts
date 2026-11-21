import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

export const integrationMeta = { dependsOnModules: ['translations', 'dictionaries'] }

test('TC-TRANS-019: injected dictionary action saves entry translations', async ({ page, request, baseURL }) => {
  const token = await getAuthToken(request, 'superadmin')
  const originalLocales = await getLocales(request, token)
  const unique = randomUUID().replaceAll('-', '')
  const dictionaryName = `QA translated dictionary ${unique}`
  const entryLabel = `Translation entry ${unique}`
  let dictionaryId: string | null = null
  let entryId: string | null = null

  try {
    await setLocales(request, token, [...new Set([...originalLocales, 'de'])])
    dictionaryId = await createDictionaryFixture(request, token, {
      key: `qa_translation_action_${unique}`,
      name: dictionaryName,
    })
    const entry = await apiRequest(request, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
      token,
      data: { value: unique, label: entryLabel },
    })
    expect(entry.status()).toBe(201)
    entryId = expectId((await readJsonSafe<{ id?: string }>(entry))?.id, 'Created entry has an id')

    await login(page, 'superadmin')
    expect(baseURL).toBeTruthy()
    await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL! }])
    await page.goto(`/backend/config/dictionaries?dictionaryId=${dictionaryId}`)
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: unique, exact: true }) })
    await row.getByRole('button', { name: 'Translate', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Translate: ${entryLabel}`, exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: 'DE', exact: true }).click()
    await dialog.getByPlaceholder(entryLabel, { exact: true }).fill('Übersetzter Wörterbucheintrag')
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
      && decodeURIComponent(new URL(response.url()).pathname) === `/api/translations/dictionaries:dictionary_entry/${entryId}`)
    await dialog.getByPlaceholder(entryLabel, { exact: true }).press('Control+Enter')
    expect((await saved).ok()).toBe(true)

    const translated = await apiRequest(request, 'GET', `/api/translations/dictionaries:dictionary_entry/${entryId}`, { token })
    expect(translated.ok()).toBe(true)
    const body = await readJsonSafe<{ translations?: Record<string, Record<string, string>> }>(translated)
    expect(body?.translations?.de?.label).toBe('Übersetzter Wörterbucheintrag')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await deleteTranslationIfExists(request, token, 'dictionaries:dictionary_entry', entryId)
    await deleteEntityByPathIfExists(request, token, dictionaryId && entryId ? `/api/dictionaries/${dictionaryId}/entries/${entryId}` : null)
    await deleteEntityByPathIfExists(request, token, dictionaryId ? `/api/dictionaries/${dictionaryId}` : null)
    await setLocales(request, token, originalLocales)
  }
})
