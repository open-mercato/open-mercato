import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildDryRunIsolationDefinitionPayload,
  buildDryRunRefusalDefinitionPayload,
  cancelWorkflowInstanceIfExists,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
  pollWorkflowInstance,
  startWorkflowInstanceFixture,
} from '@open-mercato/core/helpers/integration/workflowsFixtures'

/**
 * TC-WF-057 [P0] (API): dry-run isolation.
 *
 * Spec section 10 names the required assertions verbatim: *"test-run + dry-run
 * start (assert: no notification rows, no real UserTask, no pending proposal in
 * inbox queries, `isDryRun` excluded from KPIs)"*.
 *
 * Each is asserted against the read surface an operator would actually use, not
 * against an internal — the point of the test is that a dry run is invisible
 * everywhere real work is listed.
 *
 * Surfaces under test:
 * - POST /api/workflows/instances            (`dryRun: true`)
 * - GET  /api/workflows/instances            (default list, and `?dryRun=true`)
 * - GET  /api/workflows/instances/[id]/would-do
 * - GET  /api/workflows/tasks                (no task row was raised)
 * - GET  /api/workflows/work-inbox           (nothing to action)
 * - GET  /api/notifications                  (no notification row)
 */

type InstanceListBody = {
  data?: Array<{ id?: string; isDryRun?: boolean }>
}

type WouldDoBody = {
  isDryRun?: boolean
  stoppedByRefusal?: boolean
  entries?: Array<{ kind?: string; subject?: string; stepId?: string | null }>
}

test.describe('TC-WF-057: a dry run leaks nothing', () => {
  test('every side effect is suppressed and reported instead', async ({ request }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildDryRunIsolationDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        version: 1,
        initialContext: { probe: stamp },
        dryRun: true,
      })

      // The run pauses at the USER_TASK step — with no task row behind it.
      await pollWorkflowInstance(request, token, instanceId, (snapshot) =>
        snapshot.status === 'PAUSED' || snapshot.status === 'COMPLETED' || snapshot.status === 'FAILED')

      // (1) The instance is flagged, and is EXCLUDED from the run list by
      //     default — which is what keeps it out of anything counted off it.
      const detail = await apiRequest(request, 'GET', `/api/workflows/instances/${instanceId}`, { token })
      expect(detail.status()).toBe(200)
      const detailBody = await readJsonSafe<{ data?: { isDryRun?: boolean } }>(detail)
      expect(detailBody?.data?.isDryRun, 'the instance is marked as a dry run').toBe(true)

      const defaultList = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?workflowId=${encodeURIComponent(payload.workflowId)}&limit=100`,
        { token },
      )
      expect(defaultList.status()).toBe(200)
      const defaultBody = await readJsonSafe<InstanceListBody>(defaultList)
      expect(
        (defaultBody?.data ?? []).some((row) => row.id === instanceId),
        'a dry run is not in the default run list',
      ).toBe(false)

      const dryRunList = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?workflowId=${encodeURIComponent(payload.workflowId)}&dryRun=true&limit=100`,
        { token },
      )
      expect(dryRunList.status()).toBe(200)
      const dryRunBody = await readJsonSafe<InstanceListBody>(dryRunList)
      expect(
        (dryRunBody?.data ?? []).some((row) => row.id === instanceId),
        'asking for dry runs explicitly returns it',
      ).toBe(true)

      // (2) No real UserTask, therefore nothing in the task list…
      const tasks = await apiRequest(
        request,
        'GET',
        `/api/workflows/tasks?workflowInstanceId=${encodeURIComponent(instanceId)}&pageSize=100`,
        { token },
      )
      expect(tasks.status()).toBe(200)
      const tasksBody = await readJsonSafe<{ items?: unknown[]; data?: unknown[] }>(tasks)
      expect(
        (tasksBody?.items ?? tasksBody?.data ?? []).length,
        'a dry run raises no task row',
      ).toBe(0)

      // (3) …and therefore nothing to action in the unified Work Inbox, which is
      //     also where a pending agent proposal would surface.
      const inbox = await apiRequest(request, 'GET', '/api/workflows/work-inbox?pageSize=100', { token })
      expect(inbox.status()).toBe(200)
      const inboxBody = await readJsonSafe<{ items?: Array<{ workflowInstanceId?: string }> }>(inbox)
      expect(
        (inboxBody?.items ?? []).some((row) => row.workflowInstanceId === instanceId),
        'nothing from a dry run reaches the Work Inbox',
      ).toBe(false)

      // (4) No notification row: the task-assigned event never fired, because
      //     the row it describes was never created.
      const notifications = await apiRequest(request, 'GET', '/api/notifications?pageSize=100', { token })
      if (notifications.status() === 200) {
        const notificationsBody = await readJsonSafe<{
          items?: Array<{ body?: string; title?: string }>
        }>(notifications)
        const mentionsRun = (notificationsBody?.items ?? []).some((row) =>
          `${row.title ?? ''} ${row.body ?? ''}`.includes(String(stamp)))
        expect(mentionsRun, 'a dry run raises no notification').toBe(false)
      }

      // (5) The "Would do" report says what WOULD have happened, in order.
      const report = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${instanceId}/would-do?limit=100`,
        { token },
      )
      expect(report.status()).toBe(200)
      const reportBody = await readJsonSafe<WouldDoBody>(report)
      expect(reportBody?.isDryRun).toBe(true)
      const kinds = (reportBody?.entries ?? []).map((entry) => entry.kind)
      expect(kinds, 'the email it would have sent is reported').toContain('activity')
      expect(kinds, 'the task it would have raised is reported').toContain('userTask')
      const subjects = (reportBody?.entries ?? []).map((entry) => entry.subject)
      expect(subjects).toContain('SEND_EMAIL')
      expect(subjects).toContain('EMIT_EVENT')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('a real run of the same definition is NOT reported as a dry run', async ({ request }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildDryRunIsolationDefinitionPayload(stamp, '-real')
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      // No `dryRun` flag: opting in is the only way to get a simulation.
      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        version: 1,
        initialContext: { probe: stamp },
      })

      await pollWorkflowInstance(request, token, instanceId, (snapshot) =>
        snapshot.status === 'PAUSED' || snapshot.status === 'COMPLETED' || snapshot.status === 'FAILED')

      const detail = await apiRequest(request, 'GET', `/api/workflows/instances/${instanceId}`, { token })
      const detailBody = await readJsonSafe<{ data?: { isDryRun?: boolean } }>(detail)
      expect(detailBody?.data?.isDryRun).toBe(false)

      const list = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances?workflowId=${encodeURIComponent(payload.workflowId)}&limit=100`,
        { token },
      )
      const listBody = await readJsonSafe<InstanceListBody>(list)
      expect(
        (listBody?.data ?? []).some((row) => row.id === instanceId),
        'a real run IS in the default run list',
      ).toBe(true)

      const report = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${instanceId}/would-do`,
        { token },
      )
      expect(report.status(), 'a real run answers an empty report, not a 404').toBe(200)
      const reportBody = await readJsonSafe<WouldDoBody>(report)
      expect(reportBody?.isDryRun).toBe(false)
      expect(reportBody?.entries ?? []).toHaveLength(0)
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })

  test('an activity type that refuses simulation stops the run at that node', async ({ request }) => {
    test.setTimeout(120_000)

    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now() + randomInt(1_000)

    let definitionId: string | null = null
    let instanceId: string | null = null

    try {
      const payload = buildDryRunRefusalDefinitionPayload(stamp)
      definitionId = await createWorkflowDefinitionFixture(request, token, payload)

      instanceId = await startWorkflowInstanceFixture(request, token, {
        workflowId: payload.workflowId,
        version: 1,
        dryRun: true,
      })

      await pollWorkflowInstance(request, token, instanceId, (snapshot) =>
        snapshot.status === 'FAILED' || snapshot.status === 'COMPLETED')

      const report = await apiRequest(
        request,
        'GET',
        `/api/workflows/instances/${instanceId}/would-do?limit=100`,
        { token },
      )
      expect(report.status()).toBe(200)
      const reportBody = await readJsonSafe<WouldDoBody>(report)
      expect(reportBody?.stoppedByRefusal, 'the refusal is an explicit marker').toBe(true)
      const refusal = (reportBody?.entries ?? []).find((entry) => entry.kind === 'refusal')
      expect(refusal?.subject).toBe('EXECUTE_FUNCTION')
    } finally {
      await cancelWorkflowInstanceIfExists(request, token, instanceId)
      await deleteWorkflowDefinitionIfExists(request, token, definitionId)
    }
  })
})
