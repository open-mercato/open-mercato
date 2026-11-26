import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'entities'] }

test.skip(process.env.OM_INTEGRATION_CONFIGS_OMITTED !== '1', 'Requires the Configs-omitted integration profile')

test('TC-ENTITIES-013: entity settings and create form work with Configs omitted', async ({ page, request }) => {
  const english = JSON.parse(readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const polish = JSON.parse(readFileSync(new URL('../i18n/pl.json', import.meta.url), 'utf8')) as Record<string, string>
  const token = await getAuthToken(request, 'admin')
  const configs = await apiRequest(request, 'GET', '/api/configs/system-status', { token })
  expect(configs.status(), 'The app must omit the Configs module').toBe(404)

  const endpoint = '/api/entities/entity-settings'
  const defaultPolicy = { newEntitiesRestrictedByDefault: false, updatedAt: null }
  const initial = await apiRequest(request, 'GET', endpoint, { token })
  expect(initial.status()).toBe(200)
  expect(await readJsonSafe(initial)).toEqual(defaultPolicy)

  const refused = await apiRequest(request, 'PUT', endpoint, {
    token,
    data: { newEntitiesRestrictedByDefault: true },
  })
  expect(refused.status()).toBe(503)
  expect(await readJsonSafe(refused)).toEqual({ error: english['entities.settings.errors.storageUnavailable'] })

  const invalid = await apiRequest(request, 'PUT', endpoint, {
    token,
    data: { newEntitiesRestrictedByDefault: 'yes' },
  })
  expect(invalid.status()).toBe(400)

  const localized = await apiRequest(request, 'PUT', endpoint, {
    token,
    data: { newEntitiesRestrictedByDefault: true },
    headers: { Cookie: 'locale=pl' },
  })
  expect(localized.status()).toBe(503)
  expect(await readJsonSafe(localized)).toEqual({ error: polish['entities.settings.errors.storageUnavailable'] })

  const unchanged = await apiRequest(request, 'GET', endpoint, { token })
  expect(unchanged.status()).toBe(200)
  expect(await readJsonSafe(unchanged)).toEqual(defaultPolicy)

  await login(page, 'admin')
  await page.goto('/backend/entities/user/create')
  await expect(page.getByRole('heading', { name: 'Create Entity', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Restrict record access', exact: true })).not.toBeChecked()
  if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
    await page.screenshot({ path: test.info().outputPath('configs-omitted-create.png'), fullPage: true })
  }
})
