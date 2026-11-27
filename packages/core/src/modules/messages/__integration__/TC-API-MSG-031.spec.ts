import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
} from './scheduledSendFixtures'

/**
 * TC-API-MSG-031: a hand-off that keeps failing returns the message to drafts after
 * three attempts and notifies the author with `messages.scheduled_send_failed`.
 *
 * A running app offers no seam to make the hand-off (event emission) fail, so the
 * revert/attempt-cap logic is covered by `commands/__tests__/messages.scheduled-send.test.ts`.
 * This spec asserts the observable contract around it: the attempt counter is
 * bumped by every claim and a successful release after earlier failed attempts
 * still sends exactly once and raises no failure notification.
 */
test.describe('TC-API-MSG-031: release attempts', () => {
  test('counts the attempt and sends once without a failure notification', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject: `QA TC-API-MSG-031 ${Date.now()}`,
        body: 'Scheduled body',
        scheduledAt: scheduledAtInMinutes(30),
      })
      await withClient((client) => client.query('update messages set scheduled_release_attempts = 2 where id = $1', [messageId]))
      await makeScheduledMessageDue(messageId)
      await runScheduledRelease(token)

      expect((await readMessageScheduleRow(messageId))?.status).toBe('sent')
      const attempts = await withClient(async (client) => {
        const result = await client.query<{ scheduled_release_attempts: number }>(
          'select scheduled_release_attempts from messages where id = $1',
          [messageId],
        )
        return Number(result.rows[0]?.scheduled_release_attempts ?? 0)
      })
      expect(attempts).toBe(3)
      const failures = await listNotifications(request, token, { type: 'messages.scheduled_send_failed', pageSize: 100 })
      expect(failures.items.filter((item) => item.sourceEntityId === messageId)).toHaveLength(0)
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })

  test.fixme('three failed hand-offs return the message to drafts and notify the author', async () => {
    // Needs a fault-injection seam for the release hand-off; covered by the unit test named above.
  })
})
