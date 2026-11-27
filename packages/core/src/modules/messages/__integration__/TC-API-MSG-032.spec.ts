import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { composeMessageWithToken, decodeJwtSubject } from './helpers'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
} from './scheduledSendFixtures'

/**
 * TC-API-MSG-032: when the author is deleted, their scheduled message becomes a draft
 * and the release tick does not send it.
 */
test.describe('TC-API-MSG-032: author deleted before release', () => {
  test('returns the scheduled message to drafts and never releases it', async ({ request }) => {
    test.slow()
    const adminToken = await getAuthToken(request, 'admin')
    const recipientToken = await getAuthToken(request, 'employee')
    test.skip(!(await isSchedulingAvailable(request, adminToken)), 'scheduler module is not enabled')
    const email = `qa-tc-api-msg-032-${randomUUID()}@example.com`
    const password = 'StrongSecret123!'
    let authorId: string | null = null
    let messageId: string | null = null

    try {
      authorId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: getTokenScope(adminToken).organizationId,
        roles: ['employee'],
      })
      const authorToken = await getAuthToken(request, email, password)
      messageId = await composeMessageWithToken(request, authorToken, {
        recipients: [{ userId: decodeJwtSubject(recipientToken), type: 'to' }],
        subject: `QA TC-API-MSG-032 ${Date.now()}`,
        body: 'Scheduled body',
        scheduledAt: scheduledAtInMinutes(30),
      })
      expect((await readMessageScheduleRow(messageId))?.status).toBe('scheduled')

      await deleteUserIfExists(request, adminToken, authorId)
      authorId = null
      await drainIntegrationQueue('events')
      await expect.poll(async () => (await readMessageScheduleRow(messageId as string))?.status, {
        message: 'scheduled message returns to drafts',
      }).toBe('draft')

      await makeScheduledMessageDue(messageId)
      await runScheduledRelease(adminToken)
      const row = await readMessageScheduleRow(messageId)
      expect(row).toMatchObject({ status: 'draft', is_draft: true, sent_at: null, scheduled_at: null })
    } finally {
      await deleteUserIfExists(request, adminToken, authorId)
      if (messageId) {
        await withClient((client) => client.query('update messages set deleted_at = now() where id = $1', [messageId]))
      }
    }
  })
})
