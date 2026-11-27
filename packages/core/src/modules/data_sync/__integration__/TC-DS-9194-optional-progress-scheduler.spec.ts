import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { decodeTokenScope, deleteSyncRunsByIds, deleteSyncSchedulesByIntegration, seedSyncRun } from './helpers/db'
import { isSchedulerUnavailable, readJson, uniqueIntegrationId, type JsonRecord } from './helpers/support'

export const integrationMeta = { dependsOnModules: ['data_sync'] }

async function isModuleEnabled(request: APIRequestContext, token: string, probePath: string): Promise<boolean> {
  const probe = await apiRequest(request, 'GET', probePath, { token })
  return probe.status() !== 404
}

function expectNoResolutionError(body: JsonRecord): void {
  expect(JSON.stringify(body)).not.toMatch(/AwilixResolutionError|Could not resolve/i)
}

test.describe('TC-DS-9194: data_sync routes without the progress or scheduler module', () => {
  test('runs list, run detail and schedules list answer 200 whatever optional peers are enabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(token)
    const integrationId = uniqueIntegrationId('test_ds9194')
    const runIds: string[] = []

    try {
      runIds.push(await seedSyncRun({
        ...scope,
        integrationId,
        entityType: 'catalog.product',
        direction: 'import',
        status: 'completed',
      }))

      const list = await apiRequest(request, 'GET', `/api/data_sync/runs?integrationId=${integrationId}`, { token })
      expect(list.status()).toBe(200)
      const listBody = await readJson(list)
      expectNoResolutionError(listBody)
      const items = Array.isArray(listBody.items) ? (listBody.items as JsonRecord[]) : []
      expect(items.map((item) => String(item.id))).toContain(runIds[0])

      const detail = await apiRequest(request, 'GET', `/api/data_sync/runs/${runIds[0]}`, { token })
      expect(detail.status()).toBe(200)
      const detailBody = await readJson(detail)
      expectNoResolutionError(detailBody)
      expect(detailBody.id).toBe(runIds[0])
      expect(detailBody.status).toBe('completed')
      expect(detailBody.progressJob).toBeNull()

      const schedules = await apiRequest(request, 'GET', `/api/data_sync/schedules?integrationId=${integrationId}`, { token })
      expect(schedules.status()).toBe(200)
      const schedulesBody = await readJson(schedules)
      expectNoResolutionError(schedulesBody)
      expect(Array.isArray(schedulesBody.items)).toBe(true)
      expect(schedulesBody.total).toBe(0)
    } finally {
      await deleteSyncRunsByIds(runIds)
    }
  })

  test('without progress the run detail answers 200 with no progress job', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    test.skip(
      await isModuleEnabled(request, token, '/api/progress/active'),
      'Requires an app without the optional progress module',
    )

    const adminToken = await getAuthToken(request, 'admin')
    const scope = decodeTokenScope(adminToken)
    const integrationId = uniqueIntegrationId('test_ds9194_progress')
    const runIds: string[] = []
    try {
      runIds.push(await seedSyncRun({
        ...scope,
        integrationId,
        entityType: 'catalog.product',
        direction: 'export',
        status: 'running',
      }))
      const detail = await apiRequest(request, 'GET', `/api/data_sync/runs/${runIds[0]}`, { token: adminToken })
      expect(detail.status()).toBe(200)
      const body = await readJson(detail)
      expect(body.id).toBe(runIds[0])
      expect(body.progressJob).toBeNull()
    } finally {
      await deleteSyncRunsByIds(runIds)
    }
  })

  test('without scheduler a schedule write returns the readable missing-scheduler error', async ({ request }) => {
    const token = await getAuthToken(request, 'superadmin')
    test.skip(
      await isModuleEnabled(request, token, '/api/scheduler/jobs?pageSize=1'),
      'Requires an app without the optional scheduler module',
    )

    const adminToken = await getAuthToken(request, 'admin')
    const integrationId = uniqueIntegrationId('test_ds9194_scheduler')
    try {
      const create = await apiRequest(request, 'POST', '/api/data_sync/schedules', {
        token: adminToken,
        data: {
          integrationId,
          entityType: 'catalog.product',
          direction: 'import',
          scheduleType: 'cron',
          scheduleValue: '0 0 * * *',
          timezone: 'UTC',
        },
      })
      expect(create.status()).toBe(422)
      const body = await readJson(create)
      expectNoResolutionError(body)
      expect(isSchedulerUnavailable(body)).toBe(true)

      const list = await apiRequest(request, 'GET', `/api/data_sync/schedules?integrationId=${integrationId}`, {
        token: adminToken,
      })
      expect(list.status()).toBe(200)
      expect((await readJson(list)).total).toBe(0)
    } finally {
      await deleteSyncSchedulesByIntegration(integrationId)
    }
  })
})
