import { expect, test } from '@playwright/test'
import {
  cleanupSubscriptionSubject,
  createActivatedSubscription,
  createPortalSession,
} from './helpers/fixtures'

test.describe('TC-SUB-010: billing portal session', () => {
  test('returns a restricted Stripe billing portal URL', async ({ request }) => {
    const fixture = await createActivatedSubscription(request, 'tc_sub_010')

    try {
      const portal = await createPortalSession(request, fixture.token, fixture.externalAccountId)
      const url = new URL(portal.portalUrl)

      expect(url.hostname).toBe('billing.stripe.test')
      expect(url.searchParams.get('customer')).toBe(fixture.providerCustomerId)
      expect(url.searchParams.get('subscription_update')).toBe('false')
    } finally {
      await cleanupSubscriptionSubject(request, fixture.token, fixture.companyId)
    }
  })
})
