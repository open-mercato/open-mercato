import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import english from '../i18n/en.json' with { type: 'json' }
import polish from '../i18n/pl.json' with { type: 'json' }

export const integrationMeta = { dependsOnModules: ['auth', 'entities'] }

type EntitySettings = { newEntitiesRestrictedByDefault?: unknown; updatedAt?: unknown }

async function requireConfigsOmitted(request: APIRequestContext, token: string): Promise<void> {
  const probe = await apiRequest(request, 'GET', '/api/configs/system-status', { token })
  const status = probe.status()
  test.skip(process.env.OM_INTEGRATION_CONFIGS_OMITTED !== '1' && status !== 404, 'Requires an app without the optional configs module')
  expect(status, 'The app must omit the Configs module').toBe(404)
}

test.describe('TC-ENT-9197: custom-entity settings API without the configs module', () => {
  test('GET answers 200 with the settings shape and PUT validates before touching storage', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')

    const response = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token })
    expect(response.status(), 'entity settings must never answer 500').toBe(200)
    const body = await readJsonSafe<EntitySettings>(response)
    expect(typeof body?.newEntitiesRestrictedByDefault).toBe('boolean')
    expect(body?.updatedAt === null || typeof body?.updatedAt === 'string').toBe(true)

    const invalid = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: { newEntitiesRestrictedByDefault: 'not-a-boolean' },
    })
    expect(invalid.status()).toBe(400)
  })

  test('without configs GET falls back to the default and PUT answers a translated 503', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    await requireConfigsOmitted(request, token)

    const defaultPolicy = { newEntitiesRestrictedByDefault: false, updatedAt: null }
    const response = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token })
    expect(response.status()).toBe(200)
    expect(await readJsonSafe<EntitySettings>(response)).toEqual(defaultPolicy)

    const write = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: { newEntitiesRestrictedByDefault: true },
    })
    expect(write.status()).toBe(503)
    expect(await readJsonSafe(write)).toEqual({ error: english['entities.settings.errors.storageUnavailable'] })

    const localizedWrite = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: { newEntitiesRestrictedByDefault: true },
      headers: { Cookie: 'locale=pl' },
    })
    expect(localizedWrite.status()).toBe(503)
    expect(await readJsonSafe(localizedWrite)).toEqual({ error: polish['entities.settings.errors.storageUnavailable'] })

    const unchanged = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token })
    expect(unchanged.status()).toBe(200)
    expect(await readJsonSafe<EntitySettings>(unchanged)).toEqual(defaultPolicy)
  })

  test('without configs the settings form shows the save failure', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'superadmin')
    await requireConfigsOmitted(request, token)

    await login(page, 'admin')
    await page.goto('/backend/config/settings')
    const preference = page.getByRole('checkbox', { name: 'Restrict record access by default' })
    await expect(preference).toBeVisible()
    await preference.check()
    const saving = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === '/api/entities/entity-settings')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    const response = await saving
    expect(response.status()).toBe(503)
    const result = await response.json() as { error: string }
    expect(result.error).not.toBe('entities.settings.errors.storageUnavailable')
    await expect(page.getByRole('alert').filter({ hasText: result.error })).toBeVisible()
    await expect(preference).toBeChecked()
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await page.screenshot({ path: testInfo.outputPath('settings-storage-unavailable.png'), fullPage: true })
    }
  })

  test('without configs the create form leaves record access unrestricted by default', async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    await requireConfigsOmitted(request, token)

    await login(page, 'admin')
    await page.goto('/backend/entities/user/create')
    await expect(page.getByRole('heading', { name: 'Create Entity', exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Restrict record access', exact: true })).not.toBeChecked()
    if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
      await page.screenshot({ path: testInfo.outputPath('configs-omitted-create.png'), fullPage: true })
    }
  })
})
