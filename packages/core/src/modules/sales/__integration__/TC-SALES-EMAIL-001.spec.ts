import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

function extractQuoteToken(body: unknown): string {
  const text = String(body ?? '')
  const match = /\/quote\/([0-9a-f-]{36})/i.exec(text)
  expect(match?.[1], 'quote acceptance token should be present in the email body').toBeTruthy()
  return match![1]
}

test.describe('TC-SALES-EMAIL-001: Sales emails use system channel', () => {
  test('quote send and quote accept admin notification dispatch through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const adminEmail = process.env.ADMIN_EMAIL || 'ops@your-domain.com'
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const customerEmail = `qa-sales-email-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Quote',
        lastName: 'Recipient',
        displayName: `Quote Recipient ${stamp}`,
        primaryEmail: customerEmail,
      })

      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: {
          currencyCode: 'USD',
          customerEntityId: personId,
        },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const update = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: {
          id: quoteId,
          metadata: { customerEmail },
        },
      })
      const updateBody = await readJsonSafe<{ contactEmail?: string | null }>(update)
      expect(update.status(), `quote update response: ${JSON.stringify(updateBody)}`).toBe(200)
      expect(updateBody?.contactEmail).toBe(customerEmail)

      const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14 },
      })
      expect(send.status(), `quote send response: ${JSON.stringify(await readJsonSafe(send))}`).toBe(200)

      const quoteEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === customerEmail && String(email.metadata?.subject ?? '').startsWith('Quote '),
        { description: 'sales quote email' },
      )
      expect(String(quoteEmail.metadata?.from ?? '')).toContain('@')
      expect(quoteEmail.scope.tenantId).toBe(scope.tenantId)
      expect(quoteEmail.scope.organizationId).toBe(scope.organizationId)
      expect(quoteEmail.content.bodyFormat).toBe('html')

      const acceptanceToken = extractQuoteToken(quoteEmail.content.text ?? quoteEmail.content.html)
      await clearCapturedSystemEmails(request, token)

      const origin = process.env.BASE_URL?.trim() || 'http://127.0.0.1:3000'
      const accept = await request.post(`${origin}/api/sales/quotes/accept`, {
        data: { token: acceptanceToken },
        headers: { 'Content-Type': 'application/json', Origin: origin },
      })
      expect(accept.status()).toBe(200)
      const acceptBody = await readJsonSafe<{ orderId?: string }>(accept)
      orderId = acceptBody?.orderId ?? null
      quoteId = null

      const acceptedEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === adminEmail && String(email.metadata?.subject ?? '').includes('accepted'),
        { description: 'sales quote accepted admin email' },
      )
      expect(acceptedEmail.scope.tenantId).toBe(scope.tenantId)
      expect(acceptedEmail.scope.organizationId).toBe(scope.organizationId)
      expect(acceptedEmail.content.bodyFormat).toBe('html')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
