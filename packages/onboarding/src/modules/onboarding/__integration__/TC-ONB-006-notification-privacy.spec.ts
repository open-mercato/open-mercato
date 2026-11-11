import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { emailHashLookupValues } from '@open-mercato/core/modules/auth/lib/emailHash'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export const integrationMeta = {
  description: 'Exercises onboarding privacy and demo-feedback behavior through the app UI and API',
  dependsOnModules: ['onboarding', 'communication_channels'],
  requiredEnvVars: ['SELF_SERVICE_ONBOARDING_ENABLED'],
}

const locales = ['en', 'pl', 'es', 'de', 'ko'] as const
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const dictionaries = Object.fromEntries(locales.map((locale) => [
  locale,
  JSON.parse(readFileSync(path.join(moduleDirectory, '../i18n', `${locale}.json`), 'utf8')) as Record<string, string>,
])) as Record<(typeof locales)[number], Record<string, string>>

async function deleteOnboardingRequest(email: string) {
  const lookupValues = emailHashLookupValues(email)
  await withClient(async (client) => {
    await client.query('delete from onboarding_requests where email_hash = any($1)', [lookupValues])
  }).catch(() => undefined)
}

test.describe('TC-ONB-006: onboarding notification privacy', () => {
  test('validates localized UI, completes signup, and respects demo and recipient settings', async ({ page, request, baseURL }) => {
    test.slow()
    const origin = baseURL ?? process.env.BASE_URL ?? 'http://localhost:3000'
    const unique = randomUUID().replaceAll('-', '').slice(0, 12)
    const signupEmail = `qa-onb-006-${unique}@example.test`
    const feedbackEmail = `qa-onb-006-feedback-${unique}@example.test`
    const adminEmail = process.env.ADMIN_EMAIL?.trim()
    const token = await getAuthToken(request, 'admin')
    const channelSeedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!channelSeedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    const demoModeEnabled = parseBooleanWithDefault(process.env.DEMO_MODE, true)

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    await page.setViewportSize({ width: 390, height: 844 })

    try {
      for (const locale of locales) {
        await page.context().addCookies([{ name: 'locale', value: locale, url: origin }])
        await page.goto('/onboarding')
        await expect(page.getByRole('heading', { name: dictionaries[locale]['onboarding.title'] })).toBeVisible()
        await page.locator('button[type="submit"]').click()
        await expect(page.locator('#email-error')).toHaveText(dictionaries[locale]['onboarding.errors.emailInvalid'])
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

        if (!demoModeEnabled) {
          const disabledFeedback = await page.request.post('/api/onboarding/demo-feedback', {
            headers: { 'content-type': 'application/json' },
            data: {
              email: feedbackEmail,
              message: `QA disabled feedback ${locale} ${unique}`,
              termsAccepted: true,
              marketingConsent: false,
            },
          })
          expect(disabledFeedback.status()).toBe(404)
          expect((await disabledFeedback.json() as { error?: string }).error)
            .toBe(dictionaries[locale]['demoFeedback.errors.disabled'])
        }
      }

      await page.context().addCookies([{ name: 'locale', value: 'en', url: origin }])
      await page.goto('/onboarding')
      await page.locator('#email').fill(signupEmail)
      await page.locator('#firstName').fill('QA')
      await page.locator('#lastName').fill('Privacy')
      await page.locator('#organizationName').fill(`QA privacy ${unique}`)
      await page.locator('#password').fill(`Valid1!Pass${unique}`)
      await page.locator('#confirmPassword').fill(`Valid1!Pass${unique}`)
      await page.locator('#terms').click()
      await page.locator('button[type="submit"]').click()
      await expect(page.getByRole('status')).toContainText('Check your inbox')
      await expect(page.getByRole('status')).toContainText(signupEmail)

      const verificationEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === signupEmail
          && email.metadata?.subject === 'Confirm your email to finish onboarding',
        { description: 'signup verification email', systemRecipient: signupEmail },
      )
      expect(verificationEmail.content.bodyFormat).toBe('html')

      const signupNotifications = adminEmail
        ? await listCapturedSystemEmails(request, token, { systemRecipient: adminEmail })
        : await listCapturedSystemEmails(request, token)
      const signupAdminNotice = signupNotifications.find((email) =>
        email.metadata?.subject === 'New self-service onboarding request'
          && [email.content.text, email.content.html].some((body) => body?.includes(signupEmail)),
      )
      if (adminEmail) expect(signupAdminNotice?.metadata?.to).toBe(adminEmail)
      else expect(signupAdminNotice).toBeUndefined()

      const feedbackResponse = await request.post('/api/onboarding/demo-feedback', {
        headers: { 'content-type': 'application/json' },
        data: {
          email: feedbackEmail,
          message: `QA notification privacy ${unique}`,
          termsAccepted: true,
          marketingConsent: false,
        },
      })
      expect(feedbackResponse.status()).toBe(demoModeEnabled ? 200 : 404)
      const feedbackNotifications = await listCapturedSystemEmails(request, token)
      const feedbackNotice = feedbackNotifications.find((email) =>
        email.metadata?.subject === `Demo feedback from ${feedbackEmail}`,
      )
      if (demoModeEnabled && adminEmail) expect(feedbackNotice?.metadata?.to).toBe(adminEmail)
      else expect(feedbackNotice).toBeUndefined()
    } finally {
      await page.context().addCookies([{ name: 'locale', value: 'en', url: origin }])
      await deleteOnboardingRequest(signupEmail)
    }
  })
})
