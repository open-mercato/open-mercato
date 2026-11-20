import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['entities'] }

type EntitySettings = { newEntitiesRestrictedByDefault?: unknown; updatedAt?: unknown }

async function isConfigsModuleEnabled(request: APIRequestContext, token: string): Promise<boolean> {
  const probe = await apiRequest(request, 'GET', '/api/configs/system-status', { token })
  return probe.status() !== 404
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
    test.skip(await isConfigsModuleEnabled(request, token), 'Requires an app without the optional configs module')

    const response = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token })
    expect(response.status()).toBe(200)
    expect(await readJsonSafe<EntitySettings>(response)).toEqual({
      newEntitiesRestrictedByDefault: false,
      updatedAt: null,
    })

    const write = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: { newEntitiesRestrictedByDefault: true },
    })
    expect(write.status()).toBe(503)
    const writeBody = await readJsonSafe<{ error?: unknown }>(write)
    expect(typeof writeBody?.error).toBe('string')
    expect(String(writeBody?.error)).not.toBe('entities.settings.errors.storageUnavailable')
    expect(String(writeBody?.error).length).toBeGreaterThan(0)
  })
})
