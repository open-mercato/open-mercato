import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

// `onboarding_requests.email` is encrypted at rest, so a plaintext `where email = $1` matches
// nothing. `email_hash` is the deterministic lookup key the service itself uses; the candidate
// list covers key rotation the same way `lookupHashCandidates` does for the application.
function emailLookup(email: string): { clause: string; values: string[] } {
  return { clause: 'email_hash = any($1)', values: emailHashLookupValues(email) }
}

async function deleteOnboardingRequest(email: string): Promise<void> {
  const lookup = emailLookup(email)
  await withClient(async (client) => {
    await client.query(`delete from onboarding_requests where ${lookup.clause}`, [lookup.values])
  }).catch(() => undefined)
}

async function markOnboardingReady(email: string, tenantId: string, organizationId: string, userId: string): Promise<void> {
  const lookup = emailLookup(email)
  await withClient(async (client) => {
    const result = await client.query(
      `update onboarding_requests
       set status = 'completed',
           tenant_id = $2,
           organization_id = $3,
           user_id = $4,
           preparation_completed_at = now(),
           ready_email_sent_at = null
       where ${lookup.clause}`,
      [lookup.values, tenantId, organizationId, userId],
    )
    // Fail loudly here rather than let the status call 404 three assertions later.
    expect(result.rowCount, `markOnboardingReady should match the onboarding request for ${email}`).toBeGreaterThan(0)
  })
}

test.describe('TC-ONBOARDING-EMAIL-001: Onboarding emails use system channel', () => {
  test('start, ready, and demo feedback emails dispatch through Communications Hub', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    const stamp = Date.now()
    const onboardingEmail = `qa-onboarding-email-${stamp}@example.test`
    const feedbackEmail = `qa-demo-feedback-${stamp}@example.test`
    const adminEmail = process.env.ADMIN_EMAIL ?? 'piotr@catchthetornado.com'

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token, { systemRecipient: onboardingEmail })
    await clearCapturedSystemEmails(request, token, { systemRecipient: adminEmail })

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
        { description: 'onboarding verification email', systemRecipient: onboardingEmail },
      )
      expect(verificationEmail.scope.tenantId).toBe('system')
      expect(verificationEmail.content.bodyFormat).toBe('html')

      await waitForCapturedSystemEmail(
        request,
        token,
        (email) => String(email.metadata?.to ?? '').includes('@') && email.metadata?.subject === 'New self-service onboarding request',
        { description: 'onboarding admin email', systemRecipient: adminEmail },
      )

      await markOnboardingReady(onboardingEmail, scope.tenantId, scope.organizationId, scope.userId)
      await clearCapturedSystemEmails(request, token)

      const status = await request.get(`/api/onboarding/onboarding/status?tenantId=${encodeURIComponent(scope.tenantId)}`, {
        headers: {
          cookie: `om_login_tenant=${encodeURIComponent(scope.tenantId)}`,
        },
      })
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
        },
      })
      expect(feedback.status()).toBe(200)

      await waitForCapturedSystemEmail(
        request,
        token,
        (email) => String(email.metadata?.to ?? '').includes('@') && email.metadata?.subject === `Demo feedback from ${feedbackEmail}`,
        { description: 'demo feedback admin email', systemRecipient: adminEmail },
      )
    } finally {
      await deleteOnboardingRequest(onboardingEmail)
    }
  })
})
