import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

function uniqueIdentifier(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

async function readToggle(request: APIRequestContext, token: string, toggleId: string) {
  const response = await apiRequest(request, 'GET', `/api/feature_toggles/global/${encodeURIComponent(toggleId)}`, { token })
  expect(response.status()).toBe(200)
  return readJsonSafe<{ name?: string; description?: string | null; category?: string | null; defaultValue?: unknown }>(response)
}

test.describe('TC-FT-013: Global feature toggle update clears nullable fields sent as null', () => {
  test('PUT with null description/category clears them, omitting them keeps them', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    let toggleId: string | null = null

    try {
      const createResponse = await apiRequest(request, 'POST', '/api/feature_toggles/global', {
        token,
        data: {
          identifier: uniqueIdentifier('qa_null_clear'),
          name: 'QA Null Clear',
          description: 'Stale description',
          category: 'stale-category',
          type: 'boolean',
          defaultValue: true,
        },
      })
      expect(createResponse.status()).toBe(201)
      const created = await readJsonSafe<{ id?: string }>(createResponse)
      toggleId = expectId(created?.id, 'Toggle creation response should include id')

      const renameResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: { id: toggleId, name: 'QA Null Clear Renamed' },
      })
      expect(renameResponse.status()).toBe(200)
      const renamed = await readToggle(request, token, toggleId)
      expect(renamed?.name).toBe('QA Null Clear Renamed')
      expect(renamed?.description).toBe('Stale description')
      expect(renamed?.category).toBe('stale-category')

      const clearResponse = await apiRequest(request, 'PUT', '/api/feature_toggles/global', {
        token,
        data: { id: toggleId, description: null, category: null },
      })
      expect(clearResponse.status()).toBe(200)
      const cleared = await readToggle(request, token, toggleId)
      expect(cleared?.description).toBeNull()
      expect(cleared?.category).toBeNull()
      expect(cleared?.defaultValue).toBe(true)
    } finally {
      if (toggleId) {
        await apiRequest(request, 'DELETE', `/api/feature_toggles/global?id=${encodeURIComponent(toggleId)}`, { token }).catch(() => undefined)
      }
    }
  })
})
