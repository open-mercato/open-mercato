/**
 * TC-SALES-8459: the document's "Send to" e-mail wins over the customer record
 *
 * A quote whose metadata carries `customerEmail` (the form's "Send to" field) must
 * report and use that address even when the customer record has its own e-mail:
 * - the documents update response reports it as `contactEmail`
 * - the quote e-mail goes to it (needs the test channel seeding; skipped otherwise)
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
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

test.describe('TC-SALES-8459: Send to precedence', () => {
  test('the API reports the document address and the quote e-mail goes there', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordEmail = `qa-8459-record-${stamp}@example.test`
    const sendToEmail = `qa-8459-sendto-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `Precedence ${stamp}`,
        displayName: `SendTo Precedence ${stamp}`,
        primaryEmail: recordEmail,
      })

      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const before = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, customerReference: `PO-8459-${stamp}` },
      })
      expect(before.status()).toBe(200)
      expect((await readJsonSafe<{ contactEmail?: string | null }>(before))?.contactEmail, 'record e-mail is the fallback').toBe(recordEmail)

      const update = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, metadata: { customerEmail: sendToEmail } },
      })
      expect(update.status()).toBe(200)
      expect((await readJsonSafe<{ contactEmail?: string | null }>(update))?.contactEmail, 'Send to wins over the record e-mail').toBe(sendToEmail)

      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      if (seedingAvailable) {
        await seedSystemEmailChannel(request, token)
        await clearCapturedSystemEmails(request, token)
        const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
          token,
          data: { quoteId, validForDays: 14 },
        })
        expect(send.status()).toBe(200)
        const quoteEmail = await waitForCapturedSystemEmail(
          request,
          token,
          (email) => String(email.metadata?.subject ?? '').startsWith('Quote '),
          { description: 'sales quote email' },
        )
        expect(quoteEmail.metadata?.to, 'the quote e-mail goes to Send to').toBe(sendToEmail)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
