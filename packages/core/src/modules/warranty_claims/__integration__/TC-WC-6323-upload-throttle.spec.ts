import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createCustomerCompanyFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

test('TC-WC-6323: portal upload and replacement share a customer-scoped throttle', async ({ request }) => {
  test.setTimeout(120_000)
  const rateLimitsEnabled = process.env.OM_TEST_RATE_LIMIT_MODE === 'enabled'
  const token = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(token)
  const companyId = await createCustomerCompanyFixture(request, token)
  const userIds: string[] = []
  try {
    const owner = await createCustomerUserFixture(request, token, { customerEntityId: companyId })
    userIds.push(owner.id)
    const peer = await createCustomerUserFixture(request, token, { customerEntityId: companyId })
    userIds.push(peer.id)
    const ownerSession = await portalLogin(request, { ...owner, tenantId })
    const peerSession = await portalLogin(request, { ...peer, tenantId })
    const points = Number(process.env.RATE_LIMIT_ATTACHMENTS_UPLOAD_POINTS ?? 100)
    for (let attempt = 0; attempt < points; attempt += 1) {
      const response = await request.post('/api/warranty_claims/portal/attachments', {
        headers: portalCookieHeaders(ownerSession),
        data: {},
      })
      expect(response.status()).toBe(400)
    }
    for (const method of ['POST', 'PUT']) {
      const response = await request.fetch('/api/warranty_claims/portal/attachments', {
        method,
        headers: portalCookieHeaders(ownerSession),
        data: {},
      })
      expect(response.status()).toBe(rateLimitsEnabled ? 429 : 400)
      if (rateLimitsEnabled) expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0)
    }
    const peerResponse = await request.post('/api/warranty_claims/portal/attachments', {
      headers: portalCookieHeaders(peerSession),
      data: {},
    })
    expect(peerResponse.status()).toBe(400)
  } finally {
    for (const userId of userIds.reverse()) await deleteCustomerUserFixture(request, token, userId)
    await deleteCustomerCompanyFixture(request, token, companyId)
  }
})
