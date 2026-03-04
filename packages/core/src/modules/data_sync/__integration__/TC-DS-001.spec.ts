import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

type JsonRecord = Record<string, unknown>

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return (await response.json().catch(() => ({}))) as JsonRecord
}

const INTEGRATION_ID = 'sync_medusa_products'
const ENTITY_TYPE = 'catalog.product'

async function ensureCredentials(request: Parameters<typeof getAuthToken>[0], token: string) {
  const response = await apiRequest(request, 'PUT', `/api/integrations/${INTEGRATION_ID}/credentials`, {
    token,
    data: {
      credentials: {
        medusaApiUrl: 'https://example.medusa.local',
        medusaApiKey: 'integration-test-api-key',
      },
    },
  })
  expect(response.status()).toBe(200)
}

test.describe('TC-DS-001: Data sync hub APIs', () => {
  test('validate/run/list/detail/cancel/retry endpoints work for phase A/B scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    await ensureCredentials(request, token)

    const validateResponse = await apiRequest(request, 'POST', '/api/data_sync/validate', {
      token,
      data: {
        integrationId: INTEGRATION_ID,
        entityType: ENTITY_TYPE,
        direction: 'import',
      },
    })
    const validateBody = await readJson(validateResponse)
    expect([200, 404]).toContain(validateResponse.status())
    if (validateResponse.status() === 200) {
      expect(validateBody.ok).toBe(true)
    } else {
      expect(validateBody.ok).toBe(false)
      expect(String(validateBody.message ?? '')).toMatch(/not found|no registered sync adapter/i)
    }

    const runResponse = await apiRequest(request, 'POST', '/api/data_sync/run', {
      token,
      data: {
        integrationId: INTEGRATION_ID,
        entityType: ENTITY_TYPE,
        direction: 'import',
        fullSync: false,
        batchSize: 10,
      },
    })
    expect(runResponse.status()).toBe(201)
    const runBody = await readJson(runResponse)
    const runId = String(runBody.id)
    const progressJobId = String(runBody.progressJobId)
    expect(runId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(progressJobId).toMatch(/^[0-9a-f-]{36}$/i)

    const detailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${runId}`, { token })
    expect(detailResponse.status()).toBe(200)
    const detailBody = await readJson(detailResponse)
    expect(detailBody.id).toBe(runId)
    expect(detailBody.integrationId).toBe(INTEGRATION_ID)
    expect(detailBody.progressJobId).toBe(progressJobId)

    const listResponse = await apiRequest(
      request,
      'GET',
      `/api/data_sync/runs?integrationId=${INTEGRATION_ID}&entityType=${ENTITY_TYPE}`,
      { token },
    )
    expect(listResponse.status()).toBe(200)
    const listBody = await readJson(listResponse)
    const listItems = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
    expect(listItems.map((item) => String(item.id))).toContain(runId)

    const cancelResponse = await apiRequest(request, 'POST', `/api/data_sync/runs/${runId}/cancel`, { token })
    expect(cancelResponse.status()).toBe(200)
    const cancelBody = await readJson(cancelResponse)
    expect(cancelBody.ok).toBe(true)

    const cancelledDetailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${runId}`, { token })
    expect(cancelledDetailResponse.status()).toBe(200)
    const cancelledDetailBody = await readJson(cancelledDetailResponse)
    expect(cancelledDetailBody.status).toBe('cancelled')

    const retryResponse = await apiRequest(request, 'POST', `/api/data_sync/runs/${runId}/retry`, {
      token,
      data: { fromBeginning: false },
    })
    expect(retryResponse.status()).toBe(201)
    const retryBody = await readJson(retryResponse)
    const retryId = String(retryBody.id)
    expect(retryId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(retryId).not.toBe(runId)

    const retryDetailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${retryId}`, { token })
    expect(retryDetailResponse.status()).toBe(200)
    const retryDetailBody = await readJson(retryDetailResponse)
    expect(retryDetailBody.integrationId).toBe(INTEGRATION_ID)
    expect(retryDetailBody.direction).toBe('import')
  })
})
