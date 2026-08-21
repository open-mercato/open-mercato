import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  SCHEDULER_TRIGGER_PATH,
  createScheduleJob,
  deleteScheduleJob,
  uniqueScheduleName,
} from './helpers/scheduler'

const AUDIT_ACTIONS_PATH = '/api/audit-logs/actions'
const TRIGGER_COMMAND_ID = 'scheduler.jobs.trigger'

type ActionLogItem = {
  commandId: string
  actionLabel: string | null
  actorUserId: string | null
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
}

async function findTriggerLogEntry(
  request: APIRequestContext,
  token: string,
  resourceId: string,
): Promise<ActionLogItem | null> {
  const query = new URLSearchParams({ resourceKind: 'scheduler.job', resourceId })
  const response = await apiRequest(request, 'GET', `${AUDIT_ACTIONS_PATH}?${query.toString()}`, {
    token,
  })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: ActionLogItem[] }>(response)
  return (body?.items ?? []).find((item) => item.commandId === TRIGGER_COMMAND_ID) ?? null
}

/**
 * TC-SCHED-009: every authenticated manual trigger of a schedule is recorded in
 * the action log against the calling user — including refusals.
 *
 * Manual triggering is an authorised-looking way to make an automated job run at
 * a moment of the actor's choosing, so the attempt itself is the auditable event.
 * Both assertions below are therefore independent of QUEUE_STRATEGY: under the
 * async strategy the trigger is enqueued, under the local strategy it is refused
 * with "async required", and either way the attempt must leave an entry.
 */
test.describe('TC-SCHED-009: manual schedule triggers are written to the action log', () => {
  test('records a trigger attempt against the calling user', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let scheduleId: string | null = null

    try {
      scheduleId = await createScheduleJob(request, token, {
        name: uniqueScheduleName('Trigger-Audit'),
        scheduleType: 'interval',
        scheduleValue: '1h',
      })

      const response = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
        token,
        data: { id: scheduleId },
      })
      // 200 under the async strategy, 400 "async required" under local — the
      // attempt is audited either way.
      expect([200, 400]).toContain(response.status())

      const entry = await findTriggerLogEntry(request, token, scheduleId)
      expect(entry, 'a manual trigger writes an action-log entry').not.toBeNull()
      expect(entry?.resourceKind).toBe('scheduler.job')
      expect(entry?.resourceId).toBe(scheduleId)
      expect(entry?.actorUserId, 'the entry names the caller').toBeTruthy()
      expect(entry?.actionLabel ?? '').toMatch(/trigger/i)
      // The enqueued run is reversed through the entries the run itself writes,
      // so the trigger exposes no undo affordance (see TC-UNDO-001 §4).
      expect(entry?.undoToken).toBeNull()
    } finally {
      await deleteScheduleJob(request, token, scheduleId)
    }
  })

  test('records a refused trigger for a schedule id that does not exist', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    // A well-formed UUID that no schedule uses: the request passes validation and
    // is refused on lookup, which is exactly the probing attempt worth recording.
    const missingScheduleId = '00000000-0000-4000-8000-0000000009de'

    const response = await apiRequest(request, 'POST', SCHEDULER_TRIGGER_PATH, {
      token,
      data: { id: missingScheduleId },
    })
    expect(response.status()).toBe(404)

    const entry = await findTriggerLogEntry(request, token, missingScheduleId)
    expect(entry, 'a refused trigger still writes an action-log entry').not.toBeNull()
    expect(entry?.resourceId).toBe(missingScheduleId)
    expect(entry?.actorUserId, 'the refusal names the caller').toBeTruthy()
  })
})
