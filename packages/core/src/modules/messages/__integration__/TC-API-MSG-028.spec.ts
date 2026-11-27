import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { decodeJwtSubject, deleteMessageIfExists } from './helpers'
import { isSchedulingAvailable, readMessageScheduleRow, scheduledAtInMinutes } from './scheduledSendFixtures'

/**
 * TC-API-MSG-028: compose validates `scheduledAt` (future, ≤ max days, whole minute)
 * and answers 422 when the scheduler module is not available.
 */
test.describe('TC-API-MSG-028: scheduled send validation', () => {
  test('rejects invalid schedules and stores a valid one as a scheduled draft', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const stamp = Date.now()
    let messageId: string | null = null
    const compose = (scheduledAt: string) => apiRequest(request, 'POST', '/api/messages', {
      token: adminToken,
      data: {
        recipients: [{ userId: decodeJwtSubject(employeeToken), type: 'to' }],
        subject: `QA TC-API-MSG-028 ${stamp}`,
        body: 'Scheduled body',
        scheduledAt,
      },
    })

    try {
      if (!(await isSchedulingAvailable(request, adminToken))) {
        const unavailable = await compose(scheduledAtInMinutes(30))
        expect(unavailable.status()).toBe(422)
        return
      }

      const cases: Array<[string, string]> = [
        [scheduledAtInMinutes(-5), 'messages.errors.scheduleInPast'],
        [scheduledAtInMinutes(60 * 24 * 400), 'messages.errors.scheduleTooFar'],
        [new Date(Date.parse(scheduledAtInMinutes(30)) + 20_000).toISOString(), 'messages.errors.scheduleNotMinute'],
      ]
      for (const [scheduledAt, errorKey] of cases) {
        const response = await compose(scheduledAt)
        expect(response.status(), `scheduledAt ${scheduledAt}`).toBe(400)
        const body = await readJsonSafe<{ fieldErrors?: Record<string, string> }>(response)
        expect(body?.fieldErrors?.scheduledAt).toBe(errorKey)
      }

      const scheduledAt = scheduledAtInMinutes(30)
      const created = await compose(scheduledAt)
      expect(created.status()).toBe(201)
      messageId = (await readJsonSafe<{ id: string }>(created))?.id ?? null
      expect(messageId).toBeTruthy()
      const row = await readMessageScheduleRow(messageId as string)
      expect(row?.status).toBe('scheduled')
      expect(row?.is_draft).toBe(true)
      expect(row?.sent_at).toBeNull()
      expect(row?.scheduled_at?.toISOString()).toBe(scheduledAt)
    } finally {
      await deleteMessageIfExists(request, adminToken, messageId)
    }
  })
})
