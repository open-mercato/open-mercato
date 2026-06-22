import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import CustomerInvitationEmail from '@open-mercato/core/modules/customer_accounts/emails/CustomerInvitationEmail'
import { urlForCustomerOrg } from '@open-mercato/core/modules/customer_accounts/lib/customerUrl'

export type CustomerInvitationEmailInput = {
  container: AppContainer
  organizationId: string
  email: string
  rawToken: string
}

export async function sendCustomerInvitationEmail(input: CustomerInvitationEmailInput): Promise<void> {
  const { translate } = await resolveTranslations()
  const inviteUrl = await urlForCustomerOrg(
    input.organizationId,
    `/invite?token=${encodeURIComponent(input.rawToken)}`,
    { container: input.container },
  )

  const subject = translate('customer_accounts.invitation.email.subject', 'You have been invited to the customer portal')
  const copy = {
    preview: translate('customer_accounts.invitation.email.preview', 'Accept your invitation to finish setting up portal access.'),
    title: translate('customer_accounts.invitation.email.title', 'You have been invited'),
    body: translate(
      'customer_accounts.invitation.email.body',
      'Use this secure invitation link to create your password and access the customer portal.',
    ),
    cta: translate('customer_accounts.invitation.email.cta', 'Accept invitation'),
    hint: translate(
      'customer_accounts.invitation.email.hint',
      'This invitation link expires in 72 hours. If you did not expect this invitation, you can ignore this email.',
    ),
  }

  await sendEmail({
    to: input.email,
    subject,
    react: CustomerInvitationEmail({ inviteUrl, copy }),
  })
}
