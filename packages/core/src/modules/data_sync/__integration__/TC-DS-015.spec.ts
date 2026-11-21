import { expect, test as base, type APIRequestContext, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  BATCH_SIZE_FIXTURE_ENTITY,
  BATCH_SIZE_FIXTURE_ID,
  BATCH_SIZE_FIXTURE_TITLE,
} from './fixtures/batch-size-adapter'
import { decodeTokenScope, deleteSyncAdapterFixture, seedSyncRun, type SyncRunScope } from './helpers/db'
import { readJson } from './helpers/support'

const target = {
  integrationId: BATCH_SIZE_FIXTURE_ID,
  entityType: BATCH_SIZE_FIXTURE_ENTITY,
  direction: 'import',
} as const

const test = base.extend<{ syncFixture: { token: string; scope: SyncRunScope } }>({
  syncFixture: async ({ request }, runWithFixture) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const options = await apiRequest(request, 'GET', '/api/data_sync/options', { token })
    expect(options.status()).toBe(200)
    expect((await readJson(options)).items).toContainEqual(expect.objectContaining({
      integrationId: target.integrationId,
      supportedEntities: [target.entityType],
      defaultBatchSizes: { [target.entityType]: 500 },
    }))

    try {
      const credentials = await apiRequest(request, 'PUT', `/api/integrations/${target.integrationId}/credentials`, {
        token,
        data: { credentials: {} },
      })
      expect(credentials.status()).toBe(200)
      await runWithFixture({ token, scope })
    } finally {
      await deleteSyncAdapterFixture(target.integrationId, scope)
    }
  },
})

async function startedRunId(response: APIResponse): Promise<string> {
  expect(response.status()).toBe(201)
  const { id } = await readJson(response)
  expect(id).toEqual(expect.any(String))
  return String(id)
}

async function expectAdapterBatchSize(
  request: APIRequestContext,
  token: string,
  runId: string,
  batchSize: number,
): Promise<void> {
  await drainIntegrationQueue('data-sync-import')
  const response = await apiRequest(request, 'GET', `/api/data_sync/runs/${runId}`, { token })
  expect(response.status()).toBe(200)
  expect(await readJson(response)).toMatchObject({
    status: 'completed',
    batchesCompleted: 1,
    cursor: `batch-size:${batchSize}`,
  })
}

test.describe('TC-DS-015: Data sync adapter default batch size', () => {
  test('starts and retries at the adapter default and honors an explicit override', async ({ request, syncFixture }) => {
    const { token, scope } = syncFixture
    const omitted = await apiRequest(request, 'POST', '/api/data_sync/run', { token, data: target })
    await expectAdapterBatchSize(request, token, await startedRunId(omitted), 500)

    const overridden = await apiRequest(request, 'POST', '/api/data_sync/run', {
      token,
      data: { ...target, batchSize: 100 },
    })
    await expectAdapterBatchSize(request, token, await startedRunId(overridden), 100)

    const failedRunId = await seedSyncRun({ ...scope, ...target, status: 'failed' })
    const retry = await apiRequest(request, 'POST', `/api/data_sync/runs/${failedRunId}/retry`, {
      token,
      data: { fromBeginning: true },
    })
    const retriedRunId = await startedRunId(retry)
    expect(retriedRunId).not.toBe(failedRunId)
    await expectAdapterBatchSize(request, token, retriedRunId, 500)
  })

  test('seeds and submits the adapter default from the dashboard', async ({ page, request, syncFixture }) => {
    await login(page, 'admin')
    await page.goto('/backend/data-sync')
    const startCard = page.locator('[data-slot="card"]').filter({
      has: page.getByText('Start or schedule a sync', { exact: true }),
    })
    const integration = startCard.getByText('Integration', { exact: true }).locator('../..').getByRole('combobox')
    await integration.click()
    await page.getByRole('option', { name: BATCH_SIZE_FIXTURE_TITLE, exact: true }).click()
    const batchSize = startCard.getByText('Batch Size', { exact: true }).locator('../..').getByRole('textbox')
    await expect(batchSize).toHaveValue('500')

    const [response] = await Promise.all([
      page.waitForResponse((candidate) =>
        new URL(candidate.url()).pathname === '/api/data_sync/run' && candidate.request().method() === 'POST',
      ),
      startCard.getByRole('button', { name: 'Start sync', exact: true }).click(),
    ])
    expect(response.request().postDataJSON()).toMatchObject({ ...target, batchSize: 500 })
    expect(response.status()).toBe(201)
    const { id } = await response.json() as { id: string }
    expect(id).toEqual(expect.any(String))
    await expect(page).toHaveURL(new RegExp(`/backend/data-sync/runs/${id}$`))
    await expectAdapterBatchSize(request, syncFixture.token, id, 500)
  })
})
