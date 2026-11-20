import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'
import { isSchedulingAvailable, listMessageIds, readMessageScheduleRow, scheduledAtInMinutes } from './scheduledSendFixtures'

type Detail = { updatedAt?: string | null; status?: string; scheduledAt?: string | null; senderChannelId?: string | null }

/**
 * TC-API-MSG-030: editing a scheduled message with a stale `updated_at` answers 409;
 * cancelling the schedule returns it to drafts and keeps its `senderChannelId`;
 * rescheduling moves the time.
 */
test.describe('TC-API-MSG-030: edit, reschedule and cancel a scheduled message', () => {
  test('locks edits, reschedules and cancels back to a draft', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    const subject = `QA TC-API-MSG-030 ${Date.now()}`
    const senderChannelId = randomUUID()
    let messageId: string | null = null
    const readDetail = async (): Promise<Detail> => {
      const response = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token })
      expect(response.ok()).toBeTruthy()
      return (await readJsonSafe<Detail>(response)) ?? {}
    }
    const patch = (data: Record<string, unknown>, expectedUpdatedAt: string) => apiRequest(
      request,
      'PATCH',
      `/api/messages/${messageId}`,
      { token, data, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt } },
    )

    try {
      messageId = await composeMessageWithToken(request, token, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject,
        body: 'Scheduled body',
        scheduledAt: scheduledAtInMinutes(30),
      })
      await withClient((client) => client.query('update messages set sender_channel_id = $2 where id = $1', [messageId, senderChannelId]))

      const initial = await readDetail()
      expect(initial.status).toBe('scheduled')
      const stale = await patch({ subject: `${subject} edited` }, new Date(Date.parse(initial.updatedAt as string) - 60_000).toISOString())
      expect(stale.status()).toBe(409)

      const rescheduledAt = scheduledAtInMinutes(90)
      const rescheduled = await patch({ scheduledAt: rescheduledAt, subject: `${subject} edited` }, initial.updatedAt as string)
      expect(rescheduled.status()).toBe(200)
      expect((await readMessageScheduleRow(messageId))?.scheduled_at?.toISOString()).toBe(rescheduledAt)

      const afterReschedule = await readDetail()
      const cancelled = await patch({ scheduledAt: null }, afterReschedule.updatedAt as string)
      expect(cancelled.status()).toBe(200)

      const row = await readMessageScheduleRow(messageId)
      expect(row).toMatchObject({ status: 'draft', is_draft: true, scheduled_at: null, sender_channel_id: senderChannelId })
      expect((await readDetail()).senderChannelId).toBe(senderChannelId)
      expect(await listMessageIds(request, token, { folder: 'drafts' })).toContain(messageId)
      expect(await listMessageIds(request, token, { folder: 'scheduled' })).not.toContain(messageId)
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
