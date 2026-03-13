import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealEmail } from '../data/entities'
import { dealEmailSendSchema } from '../data/validators'
import { emitCustomersEvent } from '../events'
import {
  ensureOrganizationScope,
  ensureTenantScope,
} from './shared'
import type { EmailProviderAdapter } from '../lib/email/adapter'
import type { z } from 'zod'

type DealEmailSendInput = z.infer<typeof dealEmailSendSchema>

const sendDealEmailHandler: CommandHandler<DealEmailSendInput, { emailId: string }> = {
  id: 'customers.deal-emails.send',
  isUndoable: false,

  async execute(input, ctx) {
    const parsed = dealEmailSendSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const deal = await findOneWithDecryption(
      em,
      CustomerDeal,
      {
        id: parsed.dealId,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        deletedAt: null,
      },
      {},
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!deal) {
      throw new CrudHttpError(404, { error: 'Deal not found' })
    }

    let adapter: EmailProviderAdapter
    try {
      adapter = ctx.container.resolve('emailProviderAdapter') as EmailProviderAdapter
    } catch {
      throw new CrudHttpError(422, { error: 'Email provider adapter is not configured. Please set up email integration in CRM settings.' })
    }

    if (!ctx.auth?.email) {
      throw new CrudHttpError(400, { error: 'Authenticated user email is required to send deal emails' })
    }
    const senderEmail = String(ctx.auth.email)
    const senderName: string | undefined = ctx.auth?.name ? String(ctx.auth.name) : undefined

    const sendResult = await adapter.send({
      from: { email: senderEmail, name: senderName },
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      subject: parsed.subject,
      bodyHtml: parsed.bodyHtml,
      bodyText: parsed.bodyText,
      inReplyTo: parsed.inReplyTo,
    })

    const email = em.create(CustomerDealEmail, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      dealId: parsed.dealId,
      threadId: sendResult.threadId ?? null,
      messageId: sendResult.messageId,
      inReplyTo: parsed.inReplyTo ?? null,
      direction: 'outbound',
      fromAddress: senderEmail,
      fromName: senderName ?? null,
      toAddresses: parsed.to,
      ccAddresses: parsed.cc ?? [],
      bccAddresses: parsed.bcc ?? [],
      subject: parsed.subject,
      bodyText: parsed.bodyText ?? null,
      bodyHtml: parsed.bodyHtml,
      sentAt: new Date(),
      provider: sendResult.provider,
      providerMessageId: sendResult.providerMessageId ?? null,
      hasAttachments: false,
      isRead: true,
    })

    await em.flush()

    await emitCustomersEvent('customers.deal.email.sent', {
      id: email.id,
      dealId: deal.id,
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      subject: parsed.subject,
      direction: 'outbound',
    })

    return { emailId: email.id }
  },
}

registerCommand(sendDealEmailHandler)
export const sendDealEmailCommand = sendDealEmailHandler
