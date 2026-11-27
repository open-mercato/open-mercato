import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { listNotifications } from '@open-mercato/core/helpers/integration/notificationsFixtures'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'
import {
  isSchedulingAvailable,
  listMessageIds,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  readUnreadCount,
  runScheduledRelease,
  scheduledAtInMinutes,
} from './scheduledSendFixtures'

/**
 * TC-API-MSG-029: a scheduled internal message is invisible to its recipient (inbox,
 * unread count, `all`, `archived`, search) and absent from the sender's sent/drafts,
 * present in "scheduled"; the release makes it visible, increments the unread count
 * and notifies the recipient exactly once.
 */
test.describe('TC-API-MSG-029: scheduled internal message visibility', () => {
  test('stays hidden until release, then behaves like a sent message', async ({ request }) => {
    test.slow()
    const senderToken = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, senderToken)), 'scheduler module is not enabled')
    const subject = `QA TC-API-MSG-029 ${Date.now()}`
    let messageId: string | null = null

    try {
      const unreadBefore = await readUnreadCount(request, recipientToken)
      messageId = await composeMessageWithToken(request, senderToken, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject,
        body: 'Scheduled internal body',
        scheduledAt: scheduledAtInMinutes(30),
      })

      for (const folder of ['inbox', 'all', 'archived']) {
        expect(await listMessageIds(request, recipientToken, { folder }), `recipient ${folder}`).not.toContain(messageId)
      }
      expect(await listMessageIds(request, recipientToken, { folder: 'all', search: subject })).not.toContain(messageId)
      expect(await readUnreadCount(request, recipientToken)).toBe(unreadBefore)
      for (const folder of ['sent', 'drafts', 'all']) {
        expect(await listMessageIds(request, senderToken, { folder }), `sender ${folder}`).not.toContain(messageId)
      }
      expect(await listMessageIds(request, senderToken, { folder: 'scheduled' })).toContain(messageId)

      await makeScheduledMessageDue(messageId)
      await runScheduledRelease(senderToken)

      const row = await readMessageScheduleRow(messageId)
      expect(row?.status).toBe('sent')
      expect(row?.is_draft).toBe(false)
      expect(row?.sent_at).not.toBeNull()
      expect(await listMessageIds(request, recipientToken, { folder: 'inbox' })).toContain(messageId)
      expect(await listMessageIds(request, senderToken, { folder: 'sent' })).toContain(messageId)
      expect(await listMessageIds(request, senderToken, { folder: 'scheduled' })).not.toContain(messageId)
      expect(await readUnreadCount(request, recipientToken)).toBe(unreadBefore + 1)

      await expect.poll(async () => {
        const notifications = await listNotifications(request, recipientToken, { type: 'messages.new', pageSize: 100 })
        return notifications.items.filter((item) => item.sourceEntityId === messageId).length
      }, { message: 'recipient is notified once after release' }).toBe(1)

      await runScheduledRelease(senderToken)
      const notifications = await listNotifications(request, recipientToken, { type: 'messages.new', pageSize: 100 })
      expect(notifications.items.filter((item) => item.sourceEntityId === messageId)).toHaveLength(1)
    } finally {
      await deleteMessageIfExists(request, senderToken, messageId)
    }
  })
})
