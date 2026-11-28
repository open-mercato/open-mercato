import type { EntityManager } from '@mikro-orm/postgresql'
import { sendEmail, type SendEmailOptions } from '@open-mercato/shared/lib/email/send'
import { isUserEffectivelySuperAdmin } from './grantChecks'

export async function sendStaffCredentialEmail(
  em: EntityManager,
  userId: string,
  options: SendEmailOptions,
): Promise<void> {
  if (options.tenantId && await isUserEffectivelySuperAdmin(em, userId)) {
    return sendEmail({ ...options, tenantId: undefined, organizationId: undefined })
  }
  return sendEmail(options)
}
