import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { AUTOPAY_STATUS_POLLER_QUEUE } from '../lib/status-poller-schedule'
import {
  AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS,
  createAutopayScopeFixture,
  expectedScheduleShape,
  listAutopaySchedules,
  readAutopayScheduleRows,
  runAutopaySeedDefaults,
  setAutopayScheduleEnabled,
} from './helpers/fixtures'
import { drainEventsQueue } from './helpers/runtime'

/**
 * TC-AUTOPAY-001: Setup registers exactly one reconciliation schedule per organization
 *
 * Creating an organization runs the module's `onOrganizationCreated` hook, which
 * registers the 5-minute `gateway-autopay-status-poller` schedule through the real
 * scheduler service. Re-running setup (`mercato seed:defaults --module gateway_autopay`)
 * must update that same row rather than add a second one, and must keep a schedule an
 * operator disabled disabled. No provider call is involved.
 */
test.describe('TC-AUTOPAY-001: reconciliation schedule registration', () => {
  test('registers one schedule per organization and keeps an operator pause across re-setup', async ({ request }) => {
    test.setTimeout(AUTOPAY_INTEGRATION_TEST_TIMEOUT_MS)
    const token = await getAuthToken(request, 'superadmin')
    const fixture = await createAutopayScopeFixture(request, token, 'tc-autopay-001', drainEventsQueue)

    try {
      const { scope } = fixture

      const schedules = await listAutopaySchedules(request, token, scope)
      expect(schedules, 'the organization-created hook registers exactly one schedule').toHaveLength(1)
      expect(schedules[0]).toMatchObject({ ...expectedScheduleShape(scope), isEnabled: true })

      const rowsBefore = await readAutopayScheduleRows(scope)
      expect(rowsBefore).toHaveLength(1)
      expect(rowsBefore[0]).toMatchObject({
        id: schedules[0].id,
        is_enabled: true,
        source_type: 'module',
        target_queue: AUTOPAY_STATUS_POLLER_QUEUE,
        target_payload: { limit: 100 },
        schedule_type: 'interval',
        schedule_value: '5m',
      })
      expect(rowsBefore[0].created_by_user_id, 'module registration never stamps an acting user').toBeNull()

      await setAutopayScheduleEnabled(request, token, scope, schedules[0].id, false)
      const [pausedRow] = await readAutopayScheduleRows(scope)
      expect(pausedRow.is_enabled).toBe(false)

      runAutopaySeedDefaults()

      const rowsAfter = await readAutopayScheduleRows(scope)
      expect(rowsAfter, 'seed:defaults updates the existing row instead of adding one').toHaveLength(1)
      expect(rowsAfter[0].id).toBe(schedules[0].id)
      expect(rowsAfter[0].is_enabled, 'an operator pause survives seed:defaults').toBe(false)
      expect(rowsAfter[0].target_payload).toEqual({ limit: 100 })
      expect(
        new Date(rowsAfter[0].updated_at).getTime(),
        'seed:defaults re-registers the schedule, which touches the row',
      ).toBeGreaterThan(new Date(pausedRow.updated_at).getTime())
    } finally {
      await fixture.cleanup()
    }
  })
})
