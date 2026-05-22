import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cleanupAccessOnlyApiKey,
  cleanupSubscriptionSubject,
  createAccessOnlyApiKey,
  createSubscriptionSubject,
  fetchWithApiKey,
  STARTER_PRICE_CODE,
  SUBJECT_ENTITY_TYPE,
  syncPlans,
  uniqueExternalAccountId,
} from './helpers/fixtures'

test.describe('TC-SUB-012: API key scope enforcement', () => {
  test('rejects checkout for an API key that only has subscriptions.access', async ({ request }) => {
    const adminToken = await getAuthToken(request)
    let companyId: string | null = null
    let subjectEntityId: string | null = null
    let apiKeyFixture: { roleId: string | null; keyId: string | null; secret: string } | null = null

    try {
      await syncPlans(request, adminToken)
      const subject = await createSubscriptionSubject(request, adminToken, `QA TC-SUB-012 ${Date.now()}`)
      companyId = subject.entityId
      subjectEntityId = subject.profileId
      apiKeyFixture = await createAccessOnlyApiKey(request, adminToken)

      const response = await fetchWithApiKey(
        request,
        'POST',
        '/api/subscriptions/checkout',
        apiKeyFixture.secret,
        {
          externalAccountId: uniqueExternalAccountId('tc_sub_012'),
          subjectEntityType: SUBJECT_ENTITY_TYPE,
          subjectEntityId,
          priceCode: STARTER_PRICE_CODE,
          successUrl: 'https://merchant.test/subscriptions/success',
          cancelUrl: 'https://merchant.test/subscriptions/cancel',
        },
      )

      expect([401, 403]).toContain(response.status())
    } finally {
      await cleanupAccessOnlyApiKey(request, adminToken, apiKeyFixture)
      await cleanupSubscriptionSubject(request, adminToken, companyId)
    }
  })
})
