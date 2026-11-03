import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'

type JsonRecord = Record<string, unknown>
const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function readJson(response: APIResponse): Promise<JsonRecord> {
  return ((await readJsonSafe<JsonRecord>(response)) ?? {}) as JsonRecord
}

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

test.describe('TC-DS-010: Data sync run parameters', () => {
  test('options expose the runParameters contract for every data sync integration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const response = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
    expect(response.status()).toBe(200)
    const body = await readJson(response)
    const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []

    // The contract is provider-agnostic: every integration advertises a
    // (possibly empty) runParameters array, and each declared parameter has a
    // stable shape the UI can render generically.
    for (const item of items) {
      expect(Array.isArray(item.runParameters)).toBe(true)
      for (const param of item.runParameters as JsonRecord[]) {
        expect(typeof param.key).toBe('string')
        expect(typeof param.label).toBe('string')
        expect(['boolean', 'string', 'number', 'select']).toContain(param.type)
      }
    }
  })

  test('the run endpoint drops undeclared parameters and exposes them on the run', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const target = await detectSyncableIntegration(request, token)
    if (!target) {
      test.skip(true, 'No generic-start data sync provider modules registered — skipping run parameters test')
      return
    }

    const { integrationId, entityType } = target
    const createdRunIds: string[] = []

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
      // Undeclared parameters must be silently dropped — the run still starts,
      // and the persisted run carries no parameters because the adapter
      // declared none. This proves the parameters plumbing is additive and
      // never breaks existing runs.
      const runResponse = await apiRequest(request, 'POST', '/api/data_sync/run', {
        token,
        data: {
          integrationId,
          entityType,
          direction: 'import',
          fullSync: false,
          batchSize: 10,
          parameters: { __undeclared_flag__: true, __undeclared_value__: 'ignored' },
        },
      })
      expect(runResponse.status()).toBe(201)
      const runBody = await readJson(runResponse)
      const runId = String(runBody.id)
      createdRunIds.push(runId)
      expect(runId).toMatch(/^[0-9a-f-]{36}$/i)

      const runDetailResponse = await apiRequest(request, 'GET', `/api/data_sync/runs/${runId}`, { token })
      expect(runDetailResponse.status()).toBe(200)
      const runDetailBody = await readJson(runDetailResponse)
      // `parameters` is part of the run detail contract; with no declared
      // parameters it is null (undeclared input was dropped, not persisted).
      expect('parameters' in runDetailBody).toBe(true)
      expect(runDetailBody.parameters ?? null).toBeNull()
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
})
