import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-EMAIL-001: Checkout transactional email uses system channel', () => {
  test('public checkout submit dispatches payment-start email through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const customerEmail = `qa-checkout-email-${stamp}@example.test`
    let linkId: string | null = null

    try {
      const link = await createLinkFixture(request, token, createFixedTemplateInput({
        title: `QA checkout email ${stamp}`,
        status: 'active',
        startEmailSubject: `Checkout started ${stamp}`,
        sendStartEmail: true,
      }))
      linkId = link.id

      const submit = await submitPayLink(request, link.slug, {
        customerData: createCustomerData({ email: customerEmail }),
        acceptedLegalConsents: {},
      })
      expect(submit.status()).toBe(201)
      const body = await readJsonSafe<{ transactionId?: string }>(submit)
      expect(typeof body?.transactionId).toBe('string')

      await drainIntegrationQueue('events')
      await drainIntegrationQueue('checkout-email')

      const captured = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === customerEmail && email.metadata?.subject === `Checkout started ${stamp}`,
        { description: 'checkout payment start email' },
      )
      expect(captured.scope.tenantId).toBe(scope.tenantId)
      expect(captured.scope.organizationId).toBe(scope.organizationId)
      expect(captured.content.bodyFormat).toBe('html')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
