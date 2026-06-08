import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

async function deleteOnboardingRequest(email: string): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from onboarding_requests where email = $1', [email])
  }).catch(() => undefined)
}

async function markOnboardingReady(email: string, tenantId: string, organizationId: string, userId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update onboarding_requests
       set status = 'completed',
           tenant_id = $2,
           organization_id = $3,
           user_id = $4,
           preparation_completed_at = now(),
           ready_email_sent_at = null
       where email = $1`,
      [email, tenantId, organizationId, userId],
    )
  })
}

test.describe('TC-ONBOARDING-EMAIL-001: Onboarding emails use system channel', () => {
  test('start, ready, and demo feedback emails dispatch through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const onboardingEmail = `qa-onboarding-email-${stamp}@example.test`
    const feedbackEmail = `qa-demo-feedback-${stamp}@example.test`

    try {
      const start = await request.post('/api/onboarding/onboarding', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          email: onboardingEmail,
          firstName: 'QA',
          lastName: 'Onboarding',
          organizationName: `QA Onboarding ${stamp}`,
          password: `Valid1!Pass${stamp}`,
          confirmPassword: `Valid1!Pass${stamp}`,
          termsAccepted: true,
          marketingConsent: false,
        },
      })
      expect(start.status()).toBe(200)

      const verificationEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === onboardingEmail && email.metadata?.subject === 'Confirm your email to finish onboarding',
        { description: 'onboarding verification email' },
      )
      expect(verificationEmail.scope.tenantId).toBe('system')
      expect(verificationEmail.content.bodyFormat).toBe('html')

      await waitForCapturedSystemEmail(
        request,
        token,
        (email) => String(email.metadata?.to ?? '').includes('@') && email.metadata?.subject === 'New self-service onboarding request',
        { description: 'onboarding admin email' },
      )

      await markOnboardingReady(onboardingEmail, scope.tenantId, scope.organizationId, scope.userId)
      await clearCapturedSystemEmails(request, token)

      const status = await request.get(`/api/onboarding/onboarding/status?tenantId=${encodeURIComponent(scope.tenantId)}`)
      expect(status.status()).toBe(200)
      const readyEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === onboardingEmail && email.metadata?.subject === 'Your Open Mercato workspace is ready',
        { description: 'onboarding ready email' },
      )
      expect(readyEmail.scope.tenantId).toBe(scope.tenantId)
      expect(readyEmail.content.bodyFormat).toBe('html')

      await clearCapturedSystemEmails(request, token)
      const feedback = await request.post('/api/onboarding/demo-feedback', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          email: feedbackEmail,
          message: 'Integration coverage feedback',
          termsAccepted: true,
          marketingConsent: false,
          sendCopy: true,
        },
      })
      expect(feedback.status()).toBe(200)

      await waitForCapturedSystemEmail(
        request,
        token,
        (email) => String(email.metadata?.to ?? '').includes('@') && email.metadata?.subject === `Demo feedback from ${feedbackEmail}`,
        { description: 'demo feedback admin email' },
      )
      const feedbackCopy = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === feedbackEmail && email.metadata?.subject === 'Your feedback to Open Mercato',
        { description: 'demo feedback copy email' },
      )
      expect(feedbackCopy.scope.tenantId).toBe('system')
      expect(feedbackCopy.content.bodyFormat).toBe('html')
    } finally {
      await deleteOnboardingRequest(onboardingEmail)
    }
  })
})
