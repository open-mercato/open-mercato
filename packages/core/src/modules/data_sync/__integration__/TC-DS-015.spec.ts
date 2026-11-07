import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'
import {
  decodeTokenScope,
  deleteIntegrationStatesByIntegration,
  deleteSyncRunsByIntegration,
  seedIntegrationStates,
  seedSyncRun,
} from './helpers/db'

/**
 * TC-DS-015: retrying a run refuses a disabled integration
 *
 * `POST /api/data_sync/run` and the scheduled worker both refuse to start a run
 * while the integration is disabled for the caller's organization. Retry must
 * give the same answer: a failed run of an integration the operator has since
 * disabled may not quietly queue a new run (sync_runs row, queue job and
 * progress job) against an integration that is otherwise treated as off.
 *
 * API case: with an explicit `is_enabled = false` state row the retry answers
 * 409 `{ error: 'Integration is disabled', code: 'integrationDisabled' }` and the
 * runs list still holds only the seeded run. After the state is flipped to
 * enabled, the same retry answers 201 with a new run id — so the refusal is the
 * integration state and nothing else about the fixture.
 *
 * UI case: the run detail page's Retry button flashes the translated
 * explanation (instead of the generic "Failed to retry sync run") and stays on
 * the same run rather than navigating to a run that was never created.
 *
 * Not covered by TC-DS-001..014: TC-DS-007 covers only the status 409 and the
 * 404; TC-DS-001/013 retry runs of an enabled integration.
 */

const DISABLED_MESSAGE = 'The integration is disabled. Enable it before retrying this run.'

function listedRunIds(body: JsonRecord): string[] {
  const items = Array.isArray(body.items) ? (body.items as JsonRecord[]) : []
  return items.map((item) => String(item.id))
}

test.describe('TC-DS-015: Data sync retry refuses a disabled integration', () => {
  test('retry answers 409 integrationDisabled while disabled and 201 once enabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds015')
    const spawnedRunIds: string[] = []

    try {
      await seedIntegrationStates([{ ...scope, integrationId, isEnabled: false }])
      const failedRunId = await seedSyncRun({
        ...scope,
        integrationId,
        entityType: 'catalog.product',
        direction: 'import',
        status: 'failed',
        lastError: 'ds015 seeded failure',
      })

      const refused = await apiRequest(request, 'POST', `/api/data_sync/runs/${failedRunId}/retry`, {
        token,
        data: { fromBeginning: false },
      })
      expect(refused.status()).toBe(409)
      expect(await readJson(refused)).toEqual({ error: 'Integration is disabled', code: 'integrationDisabled' })

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/data_sync/runs?integrationId=${encodeURIComponent(integrationId)}`,
        { token },
      )
      expect(listResponse.status()).toBe(200)
      const listBody = await readJson(listResponse)
      expect(listedRunIds(listBody)).toEqual([failedRunId])
      expect(listBody.total).toBe(1)

      await deleteIntegrationStatesByIntegration(integrationId)
      await seedIntegrationStates([{ ...scope, integrationId, isEnabled: true }])

      const accepted = await apiRequest(request, 'POST', `/api/data_sync/runs/${failedRunId}/retry`, {
        token,
        data: { fromBeginning: false },
      })
      expect(accepted.status()).toBe(201)
      const acceptedBody = await readJson(accepted)
      const newRunId = String(acceptedBody.id)
      expect(newRunId).toMatch(/^[0-9a-f-]{36}$/i)
      expect(newRunId).not.toBe(failedRunId)
      spawnedRunIds.push(newRunId)
    } finally {
      for (const runId of spawnedRunIds) {
        await apiRequest(request, 'POST', `/api/data_sync/runs/${runId}/cancel`, { token })
      }
      await deleteSyncRunsByIntegration(integrationId)
      await deleteIntegrationStatesByIntegration(integrationId)
    }
  })

  test('run detail Retry explains the disabled integration and stays on the run', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds015_ui')

    try {
      await seedIntegrationStates([{ ...scope, integrationId, isEnabled: false }])
      const failedRunId = await seedSyncRun({
        ...scope,
        integrationId,
        entityType: 'catalog.product',
        direction: 'import',
        status: 'failed',
        lastError: 'ds015 seeded failure',
      })

      await login(page, 'admin')
      await page.goto(`/backend/data-sync/runs/${failedRunId}`)

      await page.getByRole('button', { name: 'Retry', exact: true }).click()

      await expect(page.getByText(DISABLED_MESSAGE)).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`/backend/data-sync/runs/${failedRunId}$`))
    } finally {
      await deleteSyncRunsByIntegration(integrationId)
      await deleteIntegrationStatesByIntegration(integrationId)
    }
  })
})
