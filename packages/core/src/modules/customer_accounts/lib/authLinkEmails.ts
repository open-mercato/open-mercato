import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import CustomerAuthLinkEmail from '@open-mercato/core/modules/customer_accounts/emails/CustomerAuthLinkEmail'
import { urlForCustomerOrg } from '@open-mercato/core/modules/customer_accounts/lib/customerUrl'

export type CustomerAuthLinkEmailInput = {
  container: AppContainer
  tenantId: string
  organizationId: string
  email: string
  rawToken: string
}

export async function sendCustomerPasswordResetEmail(input: CustomerAuthLinkEmailInput): Promise<void> {
  const { translate } = await resolveTranslations()
  const linkUrl = await urlForCustomerOrg(
    input.organizationId,
    `/reset-password?token=${encodeURIComponent(input.rawToken)}`,
    { container: input.container },
  )

  const subject = translate('customer_accounts.passwordReset.email.subject', 'Reset your portal password')
  const copy = {
    preview: translate('customer_accounts.passwordReset.email.preview', 'Use this link to choose a new portal password.'),
    title: translate('customer_accounts.passwordReset.email.title', 'Reset your password'),
    body: translate(
      'customer_accounts.passwordReset.email.body',
      'We received a request to reset the password for your portal account. Use this secure link to choose a new one.',
    ),
    cta: translate('customer_accounts.passwordReset.email.cta', 'Reset password'),
    hint: translate(
      'customer_accounts.passwordReset.email.hint',
      'This link expires in 60 minutes and can be used once. If you did not request a password reset, you can ignore this email.',
    ),
  }

  await sendEmail({
    to: input.email,
    subject,
    react: CustomerAuthLinkEmail({ linkUrl, copy }),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}

export async function sendCustomerMagicLinkEmail(input: CustomerAuthLinkEmailInput): Promise<void> {
  const { translate } = await resolveTranslations()
  const linkUrl = await urlForCustomerOrg(
    input.organizationId,
    `/magic-link?token=${encodeURIComponent(input.rawToken)}`,
    { container: input.container },
  )

  const subject = translate('customer_accounts.magicLink.email.subject', 'Your portal sign-in link')
  const copy = {
    preview: translate('customer_accounts.magicLink.email.preview', 'Use this link to sign in to the customer portal.'),
    title: translate('customer_accounts.magicLink.email.title', 'Sign in to the portal'),
    body: translate(
      'customer_accounts.magicLink.email.body',
      'Use this secure link to sign in to your portal account without a password.',
    ),
    cta: translate('customer_accounts.magicLink.email.cta', 'Sign in'),
    hint: translate(
      'customer_accounts.magicLink.email.hint',
      'This link expires in 15 minutes and can be used once. If you did not request it, you can ignore this email.',
    ),
  }

  await sendEmail({
    to: input.email,
    subject,
    react: CustomerAuthLinkEmail({ linkUrl, copy }),
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}
