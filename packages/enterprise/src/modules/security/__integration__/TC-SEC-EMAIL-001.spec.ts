import { expect, test } from '@playwright/test'
import {
  createAdminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollOtpEmail,
  loginViaApi,
  prepareOtpEmailChallenge,
} from './helpers/securityFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

test.describe('TC-SEC-EMAIL-001: Enterprise security email OTP uses system channel', () => {
  let adminToken: string
  let userId: string | null = null
  let userEmail = ''
  const userPassword = 'Valid1!Pass'

  test.beforeAll(async ({ request }) => {
    adminToken = await createAdminApiToken(request)
    const user = await createUserFixture(request, adminToken, { password: userPassword })
    userId = user.id
    userEmail = user.email
  })

  test.afterAll(async ({ request }) => {
    await deleteUserFixture(request, adminToken ?? null, userId)
  })

  test('email OTP challenge dispatches through Communications Hub when security module is enabled', async ({ request }) => {
    const seedingAvailable = await isChannelSeedingAvailable(request, adminToken)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, adminToken)
    await clearCapturedSystemEmails(request, adminToken)

    const firstLogin = await loginViaApi(request, userEmail, userPassword)
    await enrollOtpEmail(request, firstLogin.token)

    const pendingLogin = await loginViaApi(request, userEmail, userPassword)
    expect(pendingLogin.available_methods?.map((method) => method.type)).toContain('otp_email')
    const prepared = await prepareOtpEmailChallenge(request, pendingLogin.token, pendingLogin.challenge_id as string)
    expect(prepared.status).toBe(200)
    expect(prepared.code).toMatch(/^\d{6}$/)

    const captured = await waitForCapturedSystemEmail(
      request,
      adminToken,
      (email) => email.metadata?.to === userEmail && String(email.metadata?.subject ?? '').includes('verification code'),
      { description: 'security email OTP challenge' },
    )
    expect(captured.scope.tenantId).toBe('system')
    expect(captured.scope.organizationId).toBe('system')
    expect(captured.content.bodyFormat).toBe('html')
  })
})
