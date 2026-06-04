import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-001 (§3.11 scheduler.jobs).
 *
 * scheduler.jobs undo is a silent no-op (BUG #2504): the handlers read `logEntry.payload`
 * but the persisted column is `commandPayload`, so undo returns {ok:true} yet restores
 * nothing. The update-undo and delete-undo tests are quarantined with test.fixme and linked
 * to #2504 — flip to active once the handlers use extractUndoPayload.
 */

const JOBS = '/api/scheduler/jobs'

function jobBody(name: string) {
  return { name, scopeType: 'tenant', scheduleType: 'cron', scheduleValue: '0 0 * * *', timezone: 'UTC', targetType: 'queue', targetQueue: 'default' }
}
async function jobName(request: APIRequestContext, token: string, id: string) {
  const body = (await readJsonSafe(await apiRequest(request, 'GET', `${JOBS}?id=${id}`, { token }))) as any
  return (body?.items || []).find((j: any) => j.id === id)?.name
}

test.describe('TC-UNDO-001 scheduler.jobs undo/redo', () => {
  test.fixme('update → undo restores name (I1) — BUG #2504', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let id: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', JOBS, { token, data: jobBody(`Undo Job ${stamp}`) })
      id = expectOperation(createRes, 'scheduler.jobs.create').resourceId
      const before = await jobName(request, token, id as string)
      const updateOp = expectOperation(await apiRequest(request, 'PUT', JOBS, { token, data: { id, name: `Undo Job R ${stamp}` } }), 'scheduler.jobs.update')
      await undoOk(request, token, updateOp.undoToken, 'undo scheduler job update')
      expect(await jobName(request, token, id as string), 'name restored (I1)').toBe(before)
    } finally {
      if (id) await apiRequest(request, 'DELETE', `${JOBS}?id=${id}`, { token }).catch(() => {})
    }
  })

  test.fixme('delete → undo re-materializes (I2) — BUG #2504', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let id: string | null = null
    try {
      const createRes = await apiRequest(request, 'POST', JOBS, { token, data: jobBody(`Undo JobDel ${stamp}`) })
      id = expectOperation(createRes, 'scheduler.jobs.create').resourceId
      const deleteOp = expectOperation(await apiRequest(request, 'DELETE', `${JOBS}?id=${id}`, { token }), 'scheduler.jobs.delete')
      await undoOk(request, token, deleteOp.undoToken, 'undo scheduler job delete')
      expect(await jobName(request, token, id as string), 'job re-materialized (I2)').toBeDefined()
    } finally {
      if (id) await apiRequest(request, 'DELETE', `${JOBS}?id=${id}`, { token }).catch(() => {})
    }
  })
})
