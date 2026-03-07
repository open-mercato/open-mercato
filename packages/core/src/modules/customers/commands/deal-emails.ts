import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/data/encryption'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerDealEmail } from '../data/entities'
import { dealEmailSendSchema } from '../data/validators'
import { emitCustomersEvent } from '../events'
import type { EmailProviderAdapter } from '../lib/email/adapter'
import { StubEmailAdapter } from '../lib/email/adapter'
import type { z } from 'zod'

type DealEmailSendInput = z.infer<typeof dealEmailSendSchema>

export const sendDealEmailCommand = registerCommand<DealEmailSendInput, { emailId: string }>({
  id: 'customers.deal-emails.send',
  undoable: false,

  async execute(input, ctx) {
    const parsed = dealEmailSendSchema.parse(input)
    const em = ctx.container.resolve('em') as EntityManager

    const deal = await findOneWithDecryption<CustomerDeal>(
      em,
      CustomerDeal,
      {
        id: parsed.dealId,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
      },
      ctx,
    )
    if (!deal) {
      throw new Error('Deal not found')
    }

    let adapter: EmailProviderAdapter
    try {
      adapter = ctx.container.resolve('emailProviderAdapter') as EmailProviderAdapter
    } catch {
      adapter = new StubEmailAdapter()
    }

    const senderEmail = ctx.auth?.email ?? 'noreply@open-mercato.local'
    const senderName = ctx.auth?.name ?? undefined

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
})
