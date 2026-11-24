import { randomUUID } from 'node:crypto'
import { expect, test, type Request } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

export const integrationMeta = { dependsOnModules: ['translations', 'dictionaries'] }

test('TC-TRANS-019: injected dictionary action saves entry translations in a selected organization', async ({ page, request, baseURL }, testInfo) => {
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
    const translationPath = `/api/translations/dictionaries:dictionary_entry/${entryId}`

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
      && decodeURIComponent(new URL(response.url()).pathname) === translationPath)
    await dialog.getByPlaceholder(entryLabel, { exact: true }).press('Control+Enter')
    expect((await saved).ok()).toBe(true)

    const translated = await apiRequest(request, 'GET', translationPath, { token })
    expect(translated.ok()).toBe(true)
    const body = await readJsonSafe<{ translations?: Record<string, Record<string, string>> }>(translated)
    expect(body?.translations?.de?.label).toBe('Übersetzter Wörterbucheintrag')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    const organizationSwitcher = page.getByRole('button', { name: /^Organization:/ }).first()
    const organizationName = (await organizationSwitcher.innerText()).trim()
    await organizationSwitcher.click()
    await page.getByRole('button', { name: 'All organizations', exact: true }).click()
    await expect(organizationSwitcher).toHaveAccessibleName('Organization: All organizations')

    const translationRequests: string[] = []
    const recordTranslationRequest = (outgoing: Request) => {
      if (decodeURIComponent(new URL(outgoing.url()).pathname) === translationPath) {
        translationRequests.push(outgoing.method())
      }
    }
    page.on('request', recordTranslationRequest)
    await row.getByRole('button', { name: 'Translate', exact: true }).click()
    await expect(dialog).toHaveAccessibleDescription('Select a specific organization in the header to edit translations.')
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save translations' })).toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await testInfo.attach('all-organizations-refusal', { body: await page.screenshot(), contentType: 'image/png' })
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    page.off('request', recordTranslationRequest)
    expect(translationRequests).toEqual([])

    const headers = { Cookie: 'om_selected_org=__all__' }
    expect((await apiRequest(request, 'GET', translationPath, { token, headers })).status()).toBe(404)
    expect((await apiRequest(request, 'PUT', translationPath, {
      token, headers, data: { de: { label: 'A refused edit' } },
    })).status()).toBe(404)
    expect((await apiRequest(request, 'DELETE', translationPath, { token, headers })).status()).toBe(404)

    await organizationSwitcher.click()
    await page.getByRole('button', { name: organizationName, exact: true }).click()
    await expect(organizationSwitcher).toHaveAccessibleName(`Organization: ${organizationName}`)
    await row.getByRole('button', { name: 'Translate', exact: true }).click()
    await dialog.getByRole('tab', { name: 'DE', exact: true }).click()
    await expect(dialog.getByPlaceholder(entryLabel, { exact: true })).toHaveValue('Übersetzter Wörterbucheintrag')
  } finally {
    await deleteTranslationIfExists(request, token, 'dictionaries:dictionary_entry', entryId)
    await deleteEntityByPathIfExists(request, token, dictionaryId && entryId ? `/api/dictionaries/${dictionaryId}/entries/${entryId}` : null)
    await deleteEntityByPathIfExists(request, token, dictionaryId ? `/api/dictionaries/${dictionaryId}` : null)
    await setLocales(request, token, originalLocales)
  }
})
