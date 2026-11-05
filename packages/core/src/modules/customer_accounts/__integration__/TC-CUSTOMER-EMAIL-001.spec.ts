import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteCustomerUserFixture } from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

type AdminUsersResponse = {
  items?: Array<{ id: string; email: string }>
}

test.describe('TC-CUSTOMER-EMAIL-001: Customer signup email uses system channel', () => {
  test.setTimeout(60_000)

  test('fresh signup and existing-account notice dispatch through Communications Hub', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenContext(adminToken)
    const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, adminToken)
    await clearCapturedSystemEmails(request, adminToken)

    const stamp = Date.now()
    const existingEmail = `qa-customer-email-existing-${stamp}@test.local`
    const freshEmail = `qa-customer-email-fresh-${stamp}@test.local`
    let existingUserId: string | null = null
    let freshUserId: string | null = null

    try {
      const existingCreate = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: existingEmail,
          password: `ExistingPass${stamp}!`,
          displayName: `Existing Customer ${stamp}`,
        },
      })
      expect(existingCreate.status()).toBe(201)
      existingUserId = (await readJsonSafe<{ user?: { id?: string } }>(existingCreate))?.user?.id ?? null

      await clearCapturedSystemEmails(request, adminToken)
      const freshSignup = await request.post('/api/customer_accounts/signup', {
        data: {
          email: freshEmail,
          password: `FreshPass${stamp}!`,
          displayName: `Fresh Customer ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(freshSignup.status()).toBe(202)
      const verificationEmail = await waitForCapturedSystemEmail(
        request,
        adminToken,
        (email) => email.metadata?.to === freshEmail && email.metadata?.subject === 'Verify your portal account',
        { timeoutMs: 20_000, description: 'customer signup verification email' },
      )
      expect(verificationEmail.scope.tenantId).toBe(tenantId)
      expect(verificationEmail.scope.organizationId).toBe(organizationId)
      expect(verificationEmail.content.bodyFormat).toBe('html')

      const freshList = await apiRequest(
        request,
        'GET',
        `/api/customer_accounts/admin/users?search=${encodeURIComponent(freshEmail)}&pageSize=100`,
        { token: adminToken },
      )
      const freshBody = await readJsonSafe<AdminUsersResponse>(freshList)
      freshUserId = freshBody?.items?.find((item) => item.email === freshEmail)?.id ?? null

      await clearCapturedSystemEmails(request, adminToken)
      const duplicateSignup = await request.post('/api/customer_accounts/signup', {
        data: {
          email: existingEmail,
          password: `DuplicatePass${stamp}!`,
          displayName: `Duplicate Customer ${stamp}`,
          tenantId,
          organizationId,
        },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(duplicateSignup.status()).toBe(202)
      const existingNotice = await waitForCapturedSystemEmail(
        request,
        adminToken,
        (email) => email.metadata?.to === existingEmail && email.metadata?.subject === 'You already have a portal account',
        { timeoutMs: 20_000, description: 'customer existing-account notice' },
      )
      expect(existingNotice.scope.tenantId).toBe(tenantId)
      expect(existingNotice.scope.organizationId).toBe(organizationId)
    } finally {
      await deleteCustomerUserFixture(request, adminToken, freshUserId)
      await deleteCustomerUserFixture(request, adminToken, existingUserId)
    }
  })
})
