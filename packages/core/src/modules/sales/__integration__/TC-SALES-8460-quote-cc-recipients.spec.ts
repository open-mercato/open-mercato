/**
 * TC-SALES-8460: CC recipients when sending a quote
 *
 * Verifies through the API and the quote e-mail capture (needs the test channel
 * seeding; the e-mail part is skipped otherwise):
 * - `POST /api/sales/quotes/send` accepts `cc`, drops the primary address and
 *   duplicates, and remembers the list on the quote (`metadata.recipients.cc`)
 * - the main recipient gets the acceptance link; each CC recipient gets their own copy
 *   of the quote details without it
 * - an invalid CC address is rejected with 400 and the quote stays unsent
 *
 * Fixtures: one person with a primary e-mail and one quote, created through the API
 * and removed in `finally`.
 */
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  type CapturedTestSeedEmail,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

const QUOTE_LINK_PATTERN = /\/quote\//

function emailBody(email: CapturedTestSeedEmail): string {
  return `${email.content.text ?? ''}\n${email.content.html ?? ''}`
}

type QuoteItem = { metadata?: { recipients?: { cc?: string[] } } | null; status?: string | null }

async function readQuote(request: Parameters<typeof apiRequest>[0], token: string, quoteId: string): Promise<QuoteItem | undefined> {
  const response = await apiRequest(request, 'GET', `/api/sales/quotes?id=${encodeURIComponent(quoteId)}`, { token })
  expect(response.status()).toBe(200)
  return ((await readJsonSafe<{ items?: QuoteItem[] }>(response))?.items ?? [])[0]
}

test.describe('TC-SALES-8460: CC recipients on quote send', () => {
  test('sends with CC, stores the list on the quote and rejects invalid addresses', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const primaryEmail = `qa-8460-primary-${stamp}@example.test`
    const ccPurchasing = `qa-8460-purchasing-${stamp}@example.test`
    const ccAccounting = `qa-8460-accounting-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Cc',
        lastName: `Recipients ${stamp}`,
        displayName: `Cc Recipients ${stamp}`,
        primaryEmail,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const rejected = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14, cc: ['not-an-email'] },
      })
      expect(rejected.status(), 'invalid CC is rejected').toBe(400)
      expect((await readQuote(request, token, quoteId as string))?.status, 'quote stays unsent').not.toBe('sent')

      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      if (seedingAvailable) {
        await seedSystemEmailChannel(request, token)
        await clearCapturedSystemEmails(request, token)
      }

      const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14, cc: [ccPurchasing, primaryEmail, ccPurchasing, ccAccounting] },
      })
      expect(send.status(), `quote send response: ${JSON.stringify(await readJsonSafe(send))}`).toBe(200)

      const sent = await readQuote(request, token, quoteId as string)
      expect(sent?.status).toBe('sent')
      expect(sent?.metadata?.recipients?.cc, 'CC list stored without the primary address or duplicates').toEqual([ccPurchasing, ccAccounting])

      if (seedingAvailable) {
        const isQuoteEmailTo = (email: CapturedTestSeedEmail, recipient: string) =>
          email.metadata?.to === recipient && String(email.metadata?.subject ?? '').startsWith('Quote ')
        const mainEmail = await waitForCapturedSystemEmail(
          request,
          token,
          (email) => isQuoteEmailTo(email, primaryEmail),
          { description: 'sales quote email to the main recipient' },
        )
        expect(emailBody(mainEmail), 'the main recipient gets the acceptance link').toMatch(QUOTE_LINK_PATTERN)
        for (const ccRecipient of [ccPurchasing, ccAccounting]) {
          const ccEmail = await waitForCapturedSystemEmail(
            request,
            token,
            (email) => isQuoteEmailTo(email, ccRecipient),
            { description: `sales quote copy to ${ccRecipient}` },
          )
          expect(emailBody(ccEmail), 'a CC copy never carries the acceptance link').not.toMatch(QUOTE_LINK_PATTERN)
        }
        const captured = await listCapturedSystemEmails(request, token)
        expect(
          captured.filter((email) => isQuoteEmailTo(email, primaryEmail)),
          'the main recipient is not mailed twice',
        ).toHaveLength(1)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
