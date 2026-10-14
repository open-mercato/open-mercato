import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { listActionLogs, redoAction, undoAction, type ActionLogItem } from './helpers/auditLogsApi'

export const integrationMeta = {
  dependsOnModules: ['audit_logs', 'module_availability_probe'],
}

/**
 * TC-AUD-009: audit-log replay of a command of a module unavailable to the tenant.
 * Covers:
 *   - POST /api/audit_logs/audit-logs/actions/undo
 *   - POST /api/audit_logs/audit-logs/actions/redo
 *   - GET  /api/audit_logs/audit-logs/actions
 *
 * Under OM_TEST_MODE the `module_availability_probe` app module registers a
 * tenant module availability provider governing only itself, a switch
 * (`PUT /api/module_availability_probe/availability`) and an undoable command
 * (`module_availability_probe.markers.record`, run by
 * `POST /api/module_availability_probe/markers`) that persists nothing but its
 * action-log entry. While the probe module is unavailable to the tenant, undo
 * and redo of that entry are refused with the routes' existing 400 and leave it
 * untouched; once it is available again both succeed. The availability switch is
 * restored in `finally`; the command leaves no data besides its action-log rows.
 */

const PROBE_MARKER_RESOURCE_KIND = 'module_availability_probe.marker'

async function setProbeAvailability(request: APIRequestContext, token: string, available: boolean): Promise<void> {
  const response = await apiRequest(request, 'PUT', '/api/module_availability_probe/availability', {
    token,
    data: { available },
  })
  expect(response.status(), `PUT probe availability=${available} should return 200`).toBe(200)
}

async function readMarkerLog(
  request: APIRequestContext,
  token: string,
  params: { markerId: string; logId?: string },
): Promise<ActionLogItem | null> {
  const { status, body } = await listActionLogs(request, token, {
    resourceKind: PROBE_MARKER_RESOURCE_KIND,
    resourceId: params.markerId,
  })
  expect(status, 'action log list should return 200').toBe(200)
  const items = body?.items ?? []
  if (params.logId) return items.find((item) => item.id === params.logId) ?? null
  return items.find((item) => item.resourceId === params.markerId) ?? null
}

test.describe('TC-AUD-009: audit-log replay of a command of an unavailable module', () => {
  test('undo and redo are refused while the command module is unavailable and succeed once it is available again', async ({ request }) => {
    test.setTimeout(120_000)
    const token = await getAuthToken(request, 'superadmin')

    try {
      await setProbeAvailability(request, token, true)

      const markerResponse = await apiRequest(request, 'POST', '/api/module_availability_probe/markers', { token })
      expect(markerResponse.status(), 'POST probe marker should return 200').toBe(200)
      const markerId = (await readJsonSafe<{ markerId?: string }>(markerResponse))?.markerId ?? ''
      expect(markerId, 'marker id should be returned').not.toBe('')

      const recorded = await readMarkerLog(request, token, { markerId })
      expect(recorded, 'the marker command should write an action-log entry').not.toBeNull()
      expect(recorded!.executionState).toBe('done')
      const undoToken = recorded!.undoToken ?? ''
      expect(undoToken, 'the marker entry should carry an undo token').not.toBe('')
      const logId = recorded!.id

      await setProbeAvailability(request, token, false)
      const refusedUndo = await undoAction(request, token, undoToken)
      expect(refusedUndo.status(), 'undo should be refused while the module is unavailable').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(refusedUndo))?.error).toBe('Undo token not available')
      expect((await readMarkerLog(request, token, { markerId, logId }))?.executionState).toBe('done')

      await setProbeAvailability(request, token, true)
      const undone = await undoAction(request, token, undoToken)
      expect(undone.status(), 'undo should succeed once the module is available again').toBe(200)
      expect((await readJsonSafe<{ ok?: boolean }>(undone))?.ok).toBe(true)
      expect((await readMarkerLog(request, token, { markerId, logId }))?.executionState).toBe('undone')

      await setProbeAvailability(request, token, false)
      const refusedRedo = await redoAction(request, token, logId)
      expect(refusedRedo.status(), 'redo should be refused while the module is unavailable').toBe(400)
      expect((await readJsonSafe<{ error?: string }>(refusedRedo))?.error).toBe('Redo target not available')
      expect((await readMarkerLog(request, token, { markerId, logId }))?.executionState).toBe('undone')

      await setProbeAvailability(request, token, true)
      const redone = await redoAction(request, token, logId)
      expect(redone.status(), 'redo should succeed once the module is available again').toBe(200)
      expect((await readJsonSafe<{ ok?: boolean }>(redone))?.ok).toBe(true)
      expect((await readMarkerLog(request, token, { markerId, logId }))?.executionState).toBe('redone')
    } finally {
      await setProbeAvailability(request, token, true).catch(() => undefined)
    }
  })
})
