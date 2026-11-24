import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures'
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['dictionaries'] }

test('TC-DICT-8803: dictionary entries have no Translate action without translations', async ({ page, request, baseURL }) => {
  const token = await getAuthToken(request, 'superadmin')
  const locales = await apiRequest(request, 'GET', '/api/translations/locales', { token })
  expect([200, 404]).toContain(locales.status())
  test.skip(locales.status() === 200, 'Requires an app without the optional translations module')

  const unique = randomUUID().replaceAll('-', '')
  const dictionaryName = `QA optional translations ${unique}`
  let dictionaryId: string | null = null
  let entryId: string | null = null

  try {
    dictionaryId = await createDictionaryFixture(request, token, {
      key: `qa_optional_translations_${unique}`,
      name: dictionaryName,
    })
    const entry = await apiRequest(request, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
      token,
      data: { value: unique, label: 'Entry without translations' },
    })
    expect(entry.status()).toBe(201)
    entryId = expectId((await readJsonSafe<{ id?: string }>(entry))?.id, 'Created entry has an id')

    await login(page, 'superadmin')
    expect(baseURL).toBeTruthy()
    await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL! }])
    await page.goto(`/backend/config/dictionaries?dictionaryId=${dictionaryId}`)
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: unique, exact: true }) })
    await expect(row).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Entry without translations', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: /^Translate\b/ })).toHaveCount(0)
  } finally {
    await deleteEntityByPathIfExists(request, token, dictionaryId && entryId ? `/api/dictionaries/${dictionaryId}/entries/${entryId}` : null)
    await deleteEntityByPathIfExists(request, token, dictionaryId ? `/api/dictionaries/${dictionaryId}` : null)
  }
})
