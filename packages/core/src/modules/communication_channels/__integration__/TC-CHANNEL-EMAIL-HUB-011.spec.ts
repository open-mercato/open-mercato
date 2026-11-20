import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { QA_COPY_RECIPIENT, QA_RECIPIENTS, useRaisedExternalEmailBudget } from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-011 — "send separately" cannot be combined with copies.
 *
 * With more than one "to" address every recipient gets their own copy, so a
 * cc/bcc copy has no single delivery to ride on. The route refuses it with 400
 * and a field error on the offending field, before any message is composed, so
 * no channel needs to be connected for this check.
 */
test.describe('TC-CHANNEL-EMAIL-HUB-011: send separately with cc/bcc', () => {
  useRaisedExternalEmailBudget()
  const userChannelId = '00000000-0000-4000-8000-0000000000aa'

  for (const field of ['cc', 'bcc'] as const) {
    test(`rejects ${field} on a separate send to several recipients with 400`, async ({ request }) => {
      const stamp = Date.now()
      const token = await getAuthToken(request)

      const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token,
        data: {
          userChannelId,
          to: [QA_RECIPIENTS[0], QA_RECIPIENTS[1]],
          [field]: [QA_COPY_RECIPIENT],
          subject: `HUB-011 ${field} ${stamp}`,
          body: { plain: 'Should not be sent.' },
          sendSeparately: true,
        },
      })

      expect(response.status()).toBe(400)
      const body = await readJsonSafe<{ error?: string; fieldErrors?: Record<string, string> }>(response)
      expect(body?.fieldErrors?.[field], `the error lands on ${field}`).toBeTruthy()
      expect(Object.keys(body?.fieldErrors ?? {})).toEqual([field])
    })
  }

  test('allows a copy when there is a single recipient', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request)

    const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
      token,
      data: {
        userChannelId,
        to: [QA_RECIPIENTS[0]],
        cc: [QA_COPY_RECIPIENT],
        subject: `HUB-011 single ${stamp}`,
        body: { plain: 'Validation passes; the unknown channel is refused afterwards.' },
        sendSeparately: true,
      },
    })

    expect(response.status(), 'validation passes, then the unknown channel is not found').toBe(404)
  })
})
