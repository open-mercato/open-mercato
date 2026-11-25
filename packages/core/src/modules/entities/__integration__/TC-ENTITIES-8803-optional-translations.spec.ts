import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCustomEntity, deleteCustomEntityIfExists, saveFieldDefinitions, uniqueEntityId } from './helpers/entitiesApi'

export const integrationMeta = { dependsOnModules: ['entities'] }

test('TC-ENTITIES-8803: field definitions have no Translate action without translations', async ({ page, request, baseURL }) => {
  const token = await getAuthToken(request, 'superadmin')
  const locales = await apiRequest(request, 'GET', '/api/translations/locales', { token })
  expect([200, 404]).toContain(locales.status())
  test.skip(locales.status() === 200, 'Requires an app without the optional translations module')

  const entityId = uniqueEntityId('optional_translations')
  const fieldKey = 'status'

  try {
    expect((await createCustomEntity(request, token, { entityId, label: 'QA optional translations' })).status()).toBe(200)
    expect((await saveFieldDefinitions(request, token, entityId, [
      { key: fieldKey, kind: 'text', configJson: { label: 'Status without translations' } },
    ])).status()).toBe(200)

    await login(page, 'superadmin')
    expect(baseURL).toBeTruthy()
    await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL! }])
    await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}`)
    await expect(page.getByPlaceholder('snake_case', { exact: true })).toHaveValue(fieldKey)
    await expect(page.getByRole('button', { name: 'Translate field', exact: true })).toHaveCount(0)
  } finally {
    await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key: fieldKey } }).catch(() => undefined)
    await deleteCustomEntityIfExists(request, token, entityId)
  }
})
