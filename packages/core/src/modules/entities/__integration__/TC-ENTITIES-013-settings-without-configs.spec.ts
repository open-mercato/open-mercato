import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'entities'] }

test('TC-ENTITIES-013: entity settings and create form work with Configs omitted', async ({ page, request }) => {
  const english = JSON.parse(readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const polish = JSON.parse(readFileSync(new URL('../i18n/pl.json', import.meta.url), 'utf8')) as Record<string, string>
  const appRoot = process.env.OM_TEST_APP_ROOT?.trim() || path.resolve('apps/mercato')
  await bootstrapFromAppRoot(appRoot)
  const moduleIds = getModules().map((module) => module.id)
  expect(moduleIds).toContain('entities')
  test.skip(moduleIds.includes('configs'), 'This regression requires Configs omitted from the actual app module registry')

  const token = await getAuthToken(request, 'admin')
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

  await page.context().addCookies((await request.storageState()).cookies)
  await page.goto('/backend/entities/user/create')
  await expect(page.getByRole('heading', { name: 'Create Entity', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Restrict record access', exact: true })).not.toBeChecked()
  await page.screenshot({ path: test.info().outputPath('configs-omitted-create.png'), fullPage: true })
})
