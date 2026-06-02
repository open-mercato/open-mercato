import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

async function postRunWithRetry(
  request: Parameters<typeof getAuthToken>[0],
  token: string,
  data: JsonRecord,
): Promise<APIResponse> {
  let response: APIResponse | null = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await apiRequest(request, 'POST', '/api/data_sync/run', {
      token,
      data,
    })
    if (response.status() < 500) return response
    let diagnosticBody = ''
    try {
      diagnosticBody = await response.text()
    } catch {
      diagnosticBody = '<unable to read response body>'
    }
    // eslint-disable-next-line no-console
    console.error(
      `[TC-DS-001] data_sync run POST returned ${response.status()} on attempt ${attempt + 1}/3. Body: ${diagnosticBody.slice(0, 2000)}`,
    )
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  return response as APIResponse
}

/**
 * TC-DS-001: Data sync hub APIs
 *
 * Tests the core data sync API endpoints (validate, run, list, detail, cancel, retry).
 * Dynamically detects available integrations — works with or without provider modules.
 */

async function detectSyncableIntegration(
  request: Parameters<typeof getAuthToken>[0],
  token: string,
): Promise<{ integrationId: string; entityType: string } | null> {
  const listResponse = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
  if (listResponse.status() !== 200) return null
  const listBody = await readJson(listResponse)
  const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
  const runnableItems = items.filter((item) => item.canStartRun !== false)
  if (runnableItems.length === 0) return null
  const selected = runnableItems[0]
  const supportedEntities = Array.isArray(selected.supportedEntities)
    ? (selected.supportedEntities as unknown[]).filter((value): value is string => typeof value === 'string')
    : []
  if (supportedEntities.length === 0) return null
  return {
    integrationId: String(selected.integrationId),
    entityType: supportedEntities[0],
  }
}

test.describe('TC-DS-001: Data sync hub APIs', () => {
  test('validate/run/list/detail/cancel/retry endpoints work for phase A/B scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const target = await detectSyncableIntegration(request, token)
    if (!target) {
      test.skip(true, 'No generic-start data sync provider modules registered — skipping data sync run tests')
      return
    }

    const { integrationId, entityType } = target
    const createdRunIds: string[] = []

    // Ensure credentials exist so validate can proceed
    const beforeCredentialsResponse = await apiRequest(
      request,
      'GET',
      `/api/integrations/${integrationId}/credentials`,
      { token },
    )
    expect(beforeCredentialsResponse.status()).toBe(200)
    const beforeCredentialsBody = await readJson(beforeCredentialsResponse)
    const previousCredentials =
      beforeCredentialsBody.credentials && typeof beforeCredentialsBody.credentials === 'object'
        ? (beforeCredentialsBody.credentials as JsonRecord)
        : {}
    const detailResponse = await apiRequest(request, 'GET', `/api/integrations/${integrationId}`, { token })
    expect(detailResponse.status()).toBe(200)
    const detailBody = await readJson(detailResponse)
    const baselineState = detailBody.state && typeof detailBody.state === 'object'
      ? (detailBody.state as JsonRecord)
      : {}

    await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
      token,
      data: { credentials: { testApiUrl: 'https://example.test.local', testApiKey: 'integration-test-key' } },
    })
    await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/state`, {
      token,
      data: { isEnabled: true },
    })

    try {
      const validateResponse = await apiRequest(request, 'POST', '/api/data_sync/validate', {
        token,
        data: {
          integrationId,
          entityType,
          direction: 'import',
        },
      })
      const validateBody = await readJson(validateResponse)
      expect([200, 404, 422]).toContain(validateResponse.status())
      if (validateResponse.status() === 200) {
        expect(validateBody.ok).toBe(true)
      } else if (validateResponse.status() === 404) {
        expect(validateBody.ok).toBe(false)
        expect(String(validateBody.message ?? '')).toMatch(/not found|no registered sync adapter/i)
      } else {
        expect(String(validateBody.error ?? validateBody.message ?? '')).not.toHaveLength(0)
      }

      const runResponse = await postRunWithRetry(request, token, {
        integrationId,
        entityType,
        direction: 'import',
        fullSync: false,
        batchSize: 10,
      })
      expect(runResponse.status()).toBe(201)
      const runBody = await readJson(runResponse)
      const runId = String(runBody.id)
      createdRunIds.push(runId)
      const progressJobId = String(runBody.progressJobId)
      expect(runId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(progressJobId).toMatch(/^[0-9a-f-]{36}$/i)

      const detailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${runId}`, { token })
      expect(detailResponse.status()).toBe(200)
      const detailBody = await readJson(detailResponse)
      expect(detailBody.id).toBe(runId)
      expect(detailBody.integrationId).toBe(integrationId)
      expect(detailBody.progressJobId).toBe(progressJobId)

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${integrationId}&entityType=${entityType}`,
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
        data: {
          fromBeginning: false,
        },
      })
      expect(retryResponse.status()).toBe(201)
      const retryBody = await readJson(retryResponse)
      const retryId = String(retryBody.id)
      createdRunIds.push(retryId)
      expect(retryId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(retryId).not.toBe(runId)

      const retryDetailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${retryId}`, { token })
      expect(retryDetailResponse.status()).toBe(200)
      const retryDetailBody = await readJson(retryDetailResponse)
      expect(retryDetailBody.integrationId).toBe(integrationId)
      expect(retryDetailBody.direction).toBe('import')
    } finally {
      await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/credentials`, {
        token,
        data: { credentials: previousCredentials },
      })
      await apiRequest(request, 'PUT', `/api/integrations/${integrationId}/state`, {
        token,
        data: {
          isEnabled:
            typeof baselineState.isEnabled === 'boolean'
              ? baselineState.isEnabled
              : false,
        },
      })

      for (const runId of createdRunIds) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${runId}/cancel`, { token })
      }
    }
  })

  test('authorization is enforced for run endpoint', async ({ request }) => {
    const withoutToken = await request.post(`${BASE_URL}/api/data_sync/run`, {
      data: {
        integrationId: 'any',
        entityType: 'catalog.product',
        direction: 'import',
      },
    })
    expect(withoutToken.status()).toBe(401)

    const employeeToken = await getAuthToken(request, 'employee')
    const forbidden = await apiRequest(request, 'POST', '/api/data_sync/run', {
      token: employeeToken,
      data: {
        integrationId: 'any',
        entityType: 'catalog.product',
        direction: 'import',
      },
    })
    expect(forbidden.status()).toBe(403)
  })
})
