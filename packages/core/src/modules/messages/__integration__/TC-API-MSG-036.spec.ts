import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
} from './scheduledSendFixtures'

async function readUpdatedAt(request: APIRequestContext, token: string, messageId: string): Promise<string> {
  const response = await apiRequest(request, 'GET', `/api/messages/${messageId}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ updatedAt?: string }>(response)
  return body?.updatedAt as string
}

async function patchMessage(request: APIRequestContext, token: string, messageId: string, data: Record<string, unknown>) {
  const updatedAt = await readUpdatedAt(request, token, messageId)
  return apiRequest(request, 'PATCH', `/api/messages/${messageId}`, {
    token,
    data,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt },
  })
}

async function readReleaseState(messageId: string) {
  return withClient(async (client) => {
    const result = await client.query<{ attempts: number; recipients: string }>(
      `select m.scheduled_release_attempts as attempts,
              (select count(*) from message_recipients r where r.message_id = m.id) as recipients
         from messages m where m.id = $1`,
      [messageId],
    )
    return { attempts: Number(result.rows[0]?.attempts), recipients: Number(result.rows[0]?.recipients) }
  })
}

/**
 * TC-API-MSG-036: an edit and the scheduled release never both win. A message the release
 * worker holds (`releasing`) refuses edits with 409 and is still released once its lease
 * expires; a scheduled message sent now is not released a second time.
 */
test.describe('TC-API-MSG-036: draft edit vs scheduled release', () => {
  test('refuses to edit a releasing message and releases it after the lease expires', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject: `QA TC-API-MSG-036 releasing ${Date.now()}`,
        body: 'Scheduled body',
        scheduledAt: scheduledAtInMinutes(30),
      })
      await withClient((client) => client.query(
        `update messages set status = 'releasing', scheduled_at = now() - interval '1 minute' where id = $1`,
        [messageId],
      ))

      const cancel = await patchMessage(request, token, messageId, { scheduledAt: null })
      expect(cancel.status()).toBe(409)
      const sendNow = await patchMessage(request, token, messageId, { scheduledAt: null, isDraft: false })
      expect(sendNow.status()).toBe(409)
      expect(await readMessageScheduleRow(messageId)).toMatchObject({ status: 'releasing', is_draft: true, sent_at: null })

      await runScheduledRelease(token)
      expect((await readMessageScheduleRow(messageId))?.status, 'a live lease is not taken over').toBe('releasing')

      await withClient((client) => client.query(
        `update messages set updated_at = now() - interval '11 minutes' where id = $1`,
        [messageId],
      ))
      await runScheduledRelease(token)
      expect(await readMessageScheduleRow(messageId)).toMatchObject({ status: 'sent', is_draft: false, scheduled_at: null })
      expect((await readMessageScheduleRow(messageId))?.sent_at).not.toBeNull()
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })

  test('does not release a scheduled message again after "Send now"', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')
    let messageId: string | null = null

    try {
      messageId = await composeMessageWithToken(request, token, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject: `QA TC-API-MSG-036 send now ${Date.now()}`,
        body: 'Scheduled body',
        scheduledAt: scheduledAtInMinutes(30),
      })

      const sendNow = await patchMessage(request, token, messageId, { scheduledAt: null, isDraft: false })
      expect(sendNow.status()).toBe(200)
      const sent = await readMessageScheduleRow(messageId)
      expect(sent).toMatchObject({ status: 'sent', is_draft: false, scheduled_at: null })

      await makeScheduledMessageDue(messageId)
      await runScheduledRelease(token)

      const after = await readMessageScheduleRow(messageId)
      expect(after?.status).toBe('sent')
      expect(after?.sent_at?.toISOString()).toBe(sent?.sent_at?.toISOString())
      expect(await readReleaseState(messageId)).toEqual({ attempts: 0, recipients: 1 })
    } finally {
      await deleteMessageIfExists(request, token, messageId)
    }
  })
})
