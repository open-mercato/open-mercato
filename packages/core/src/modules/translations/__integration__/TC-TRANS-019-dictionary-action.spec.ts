import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { deleteEntityByPathIfExists, expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTranslationIfExists, getLocales, setLocales } from './helpers/translationFixtures'

export const integrationMeta = { dependsOnModules: ['translations', 'dictionaries', 'directory'] }

test('TC-TRANS-019: injected dictionary action saves entry translations', async ({ page, request, baseURL }, testInfo) => {
  const token = await getAuthToken(request, 'superadmin')
  const { organizationId, tenantId } = getTokenScope(token)
  const originalLocales = await getLocales(request, token)
  const unique = randomUUID().replaceAll('-', '')
  const dictionaryName = `QA translated dictionary ${unique}`
  const entryLabel = `Translation entry ${unique}`
  let dictionaryId: string | null = null
  let entryId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null

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
    const translate = row.getByRole('button', { name: `Translate ${entryLabel}`, exact: true })
    const dialog = page.getByRole('dialog', { name: `Translate: ${entryLabel}`, exact: true })
    const translationPath = `/api/translations/dictionaries:dictionary_entry/${entryId}`
    const switcher = page.getByRole('button', { name: /^Organization:/ }).first()
    await switcher.click()
    await page.getByRole('button', { name: 'All organizations', exact: true }).click()
    await expect(switcher).toHaveAccessibleName('Organization: All organizations')

    const translationRequests: string[] = []
    page.on('request', (sent) => {
      if (decodeURIComponent(new URL(sent.url()).pathname) === translationPath) {
        translationRequests.push(sent.method())
      }
    })
    await translate.click()
    await expect(dialog).toHaveAccessibleDescription(
      'Select one organization in the organization switcher to translate this dictionary entry.',
    )
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save translations', exact: true })).toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await testInfo.attach('all-organizations-refusal', { body: await page.screenshot(), contentType: 'image/png' })
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    expect(translationRequests).toEqual([])

    const query = new URLSearchParams({ view: 'options', tenantId, ids: organizationId })
    const organization = await apiRequest(request, 'GET', `/api/directory/organizations?${query}`, { token })
    expect(organization.ok()).toBe(true)
    const organizationName = (await readJsonSafe<{ items: { id: string; name: string }[] }>(organization))
      ?.items.find((item) => item.id === organizationId)?.name ?? ''
    expect(organizationName).toBeTruthy()
    await switcher.click()
    await page.getByRole('button', { name: organizationName, exact: true }).click()
    await expect(switcher).toHaveAccessibleName(`Organization: ${organizationName}`)
    await translate.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('tab', { name: 'DE', exact: true }).click()
    const translationInput = dialog.getByRole('textbox', { name: 'Label — Translation (DE)', exact: true })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(translationInput).toBeInViewport({ ratio: 1 })
      const inputBounds = await translationInput.boundingBox()
      const dialogBounds = await dialog.boundingBox()
      expect(inputBounds).not.toBeNull()
      expect(dialogBounds).not.toBeNull()
      expect(inputBounds!.x).toBeGreaterThanOrEqual(dialogBounds!.x)
      expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(dialogBounds!.x + dialogBounds!.width)
      if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
        await page.screenshot({ path: testInfo.outputPath(`translation-${width}.png`), fullPage: true })
      }
    }
    await translationInput.fill('Übersetzter Wörterbucheintrag')

    const scopeCookie = (await page.context().cookies(baseURL!)).find(({ name }) => name === 'om_selected_org')
    expect(scopeCookie?.value).toBe(organizationId)
    await page.context().addCookies([{ name: 'om_selected_org', value: '__all__', url: baseURL! }])
    await translationInput.press('Control+Enter')
    await expect(page.getByText(
      'The organization selection changed. Close and reopen the translation editor to continue.',
      { exact: true },
    )).toBeVisible()
    expect(translationRequests).not.toContain('PUT')
    await expect(translationInput).toHaveValue('Übersetzter Wörterbucheintrag')
    await page.context().addCookies([scopeCookie!])

    const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
      && decodeURIComponent(new URL(response.url()).pathname) === translationPath)
    await translationInput.press('Control+Enter')
    expect((await saved).ok()).toBe(true)
    expect(translationRequests).toContain('PUT')

    const aggregateScope = { Cookie: 'om_selected_org=__all__' }
    expect((await apiRequest(request, 'GET', translationPath, { token, headers: aggregateScope })).status()).toBe(404)
    expect((await apiRequest(request, 'PUT', translationPath, {
      token, headers: aggregateScope, data: { de: { label: 'A refused edit' } },
    })).status()).toBe(404)
    expect((await apiRequest(request, 'DELETE', translationPath, { token, headers: aggregateScope })).status()).toBe(404)

    const email = `qa-trans-dictionary-${unique}@example.com`
    const password = `Translation1!${unique}`
    roleId = await createRoleFixture(request, token, { name: `qa_trans_dictionary_${unique}`, tenantId })
    await setRoleAclFeatures(request, token, {
      roleId,
      features: ['translations.view', 'translations.manage'],
      organizations: [organizationId],
    })
    userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] })
    await withCredentialIsolatedRequest(async (isolatedRequest) => {
      const restrictedToken = await getAuthToken(isolatedRequest, email, password)
      const locales = await apiRequest(isolatedRequest, 'GET', '/api/translations/locales', { token: restrictedToken })
      expect(locales.status()).toBe(200)
      const deniedRead = await apiRequest(isolatedRequest, 'GET', translationPath, { token: restrictedToken })
      expect(deniedRead.status()).toBe(403)
      const deniedWrite = await apiRequest(isolatedRequest, 'PUT', translationPath, {
        token: restrictedToken,
        data: { de: { label: 'Unzulässige Änderung' } },
      })
      expect(deniedWrite.status()).toBe(403)
    })

    const translated = await apiRequest(request, 'GET', translationPath, { token })
    expect(translated.ok()).toBe(true)
    const body = await readJsonSafe<{ translations?: Record<string, Record<string, string>> }>(translated)
    expect(body?.translations?.de?.label).toBe('Übersetzter Wörterbucheintrag')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await translate.click()
    await dialog.getByRole('tab', { name: 'DE', exact: true }).click()
    await expect(translationInput).toHaveValue('Übersetzter Wörterbucheintrag')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  } finally {
    await deleteUserIfExists(request, token, userId)
    await deleteRoleIfExists(request, token, roleId)
    await deleteTranslationIfExists(request, token, 'dictionaries:dictionary_entry', entryId)
    await deleteEntityByPathIfExists(request, token, dictionaryId && entryId ? `/api/dictionaries/${dictionaryId}/entries/${entryId}` : null)
    await deleteEntityByPathIfExists(request, token, dictionaryId ? `/api/dictionaries/${dictionaryId}` : null)
    await setLocales(request, token, originalLocales)
  }
})
