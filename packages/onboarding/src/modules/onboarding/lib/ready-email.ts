import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { defaultLocale, locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { OnboardingService } from '@open-mercato/onboarding/modules/onboarding/lib/service'
import WorkspaceReadyEmail from '@open-mercato/onboarding/modules/onboarding/emails/WorkspaceReadyEmail'

function resolveLocale(rawLocale: string | null | undefined): Locale {
  if (rawLocale && locales.includes(rawLocale as Locale)) return rawLocale as Locale
  return defaultLocale
}

export async function sendWorkspaceReadyEmail(args: {
  requestId: string
  baseUrl: string
  tenantId: string
}) {
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = new OnboardingService(em)
  const request = await service.findById(args.requestId)
  if (!request || request.readyEmailSentAt) return false
  const locale = resolveLocale(request.locale)
  const dict = await loadDictionary(locale)
  const translate = createFallbackTranslator(dict)
  const loginUrl = `${args.baseUrl}/login?tenant=${encodeURIComponent(args.tenantId)}`
  const firstName = request.firstName?.trim() || request.organizationName?.trim() || request.email
  const subject = translate('onboarding.readyEmail.subject', 'Your Open Mercato workspace is ready')
  const emailCopy = {
    preview: translate('onboarding.readyEmail.preview', 'Your workspace is ready. Use your secure login link to sign in.'),
    heading: translate('onboarding.readyEmail.heading', 'Your workspace is ready'),
    greeting: translate('onboarding.readyEmail.greeting', 'Hi {firstName},', { firstName }),
    body: translate(
      'onboarding.readyEmail.body',
      'Your Open Mercato workspace for {organizationName} has finished preparing. Use the secure link below to sign in.',
      { organizationName: request.organizationName },
    ),
    cta: translate('onboarding.readyEmail.cta', 'Open login'),
    footer: translate('onboarding.readyEmail.footer', 'Open Mercato · Onboarding service'),
  }

  await sendEmail({
    to: request.email,
    subject,
    react: WorkspaceReadyEmail({ loginUrl, copy: emailCopy }),
  })
  await service.markReadyEmailSent(request, new Date())
  return true
}
